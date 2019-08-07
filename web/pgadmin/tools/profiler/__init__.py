####################################################################################################
#
#
# Todo: implement support for edb funcs, ppas, trigger functions, procedures
#
#
#
####################################################################################################

"""A blueprint module implementing the profiler"""

MODULE_NAME = 'profiler'

# Python imports
import simplejson as json
import random
import re # unnecessary?
from datetime import datetime

# Flask imports
from flask import url_for, Response, render_template, request, session, \
    current_app
from flask_babelex import gettext
from flask_security import login_required
from werkzeug.useragents import UserAgent

# pgAdmin utils imports
from pgadmin.utils import PgAdminModule, \
    SHORTCUT_FIELDS as shortcut_fields,  \
    ACCESSKEY_FIELDS as accesskey_fields
from pgadmin.utils.ajax import bad_request
from pgadmin.utils.ajax import make_json_response, \
    internal_server_error
from pgadmin.utils.driver import get_driver
from pgadmin.settings import get_setting

# other imports
from config import PG_DEFAULT_DRIVER
from pgadmin.model import db, ProfilerSavedReports, ProfilerFunctionArguments
from pgadmin.tools.profiler.utils.profiler_instance import ProfilerInstance

#
from plprofiler import  plprofiler_report

# Constants
ASYNC_OK = 1

####################################################################################################

class ProfilerModule(PgAdminModule):
    """
    class ProfilerModule(PgAdminModule)

        A module class for profiler which is derived from PgAdminModule.

    Methods:
    -------
    * get_own_javascripts(self)
      - Method is used to load the required javascript files for profiler
      module

    """
    LABEL = gettext("Profiler")

    def get_own_javascripts(self):
        scripts = list()
        for name, script in [
            ['pgadmin.tools.profiler.controller', 'js/profiler'],
            ['pgadmin.tools.profiler.ui', 'js/profiler_ui'],
            ['pgadmin.tools.profiler.direct', 'js/direct']
        ]:
            scripts.append({
                'name': name,
                'path': url_for('profiler.index') + script,
                'when': None
            })

        return scripts

    def register_preferences(self):
        self.open_in_new_tab = self.preference.register(
            'display', 'profiler_new_browser_tab',
            gettext("Open in new browser tab"), 'boolean', True,
            category_label=gettext('Display'),
            help_str=gettext('If set to True, the Profiler '
                             'will be opened in a new browser tab.')
        )

    # TODO: Keyboard shortcuts

    def get_exposed_url_endpoints(self):
        return ['profiler.index', 'profiler.init_for_function',
                'profiler.init_for_trigger',
                'profiler.direct', 'profiler.initialize_target_for_function',
                'profiler.initialize_target_for_trigger', 'profiler.close',
                'profiler.get_parameters',
                #'profiler.restart',
                'profiler.start_listener',
                'profiler.start_execution',
                'profiler.show_report', 'profiler.get_src',
                'profiler.get_reports',
                #'profiler.deposit_value',
                'profiler.set_arguments', 'profiler.get_arguments'
                #'profiler.poll_end_execution_result'#, 'profiler.poll_result'
                ]


    def on_logout(self, user):
        """
        This is a callback function when user logout from pgAdmin
        :param user:
        :return:
        """
        close_profiler_session(None, close_all=True)

####################################################################################################

blueprint = ProfilerModule(MODULE_NAME, __name__)

@blueprint.route("/", endpoint='index')
@login_required
def index():
    return bad_request(
        errormsg=gettext("This URL cannot be called directly.")
    )

@blueprint.route("/js/profiler.js")
@login_required
def script():
    """render the main profiler javascript file"""
    return Response(
        response=render_template("profiler/js/profiler.js", _=gettext),
        status=200,
        mimetype="application/javascript"
    )

@blueprint.route("/js/profiler_ui.js")
@login_required
def script_profiler_js():
    """render the profiler UI javascript file"""
    return Response(
        response=render_template("profiler/js/profiler_ui.js", _=gettext),
        status=200,
        mimetype="application/javascript"
    )


@blueprint.route("/js/direct.js")
@login_required
def script_profiler_direct_js():
    """
    Render the javascript file required send and receive the response
    from server for profiling
    """
    return Response(
        response=render_template("profiler/js/direct.js", _=gettext),
        status=200,
        mimetype="application/javascript"
    )

####################################################################################################

@blueprint.route(
    '/init/<node_type>/<int:sid>/<int:did>/<int:scid>/<int:fid>',
    methods=['GET'], endpoint='init_for_function'
)
@blueprint.route(
    '/init/<node_type>/<int:sid>/<int:did>/<int:scid>/<int:fid>/<int:trid>',
    methods=['GET'], endpoint='init_for_trigger'
)
@login_required
def init_function(node_type, sid, did, scid, fid, trid=None):
    """
    init_function(node_type, sid, did, scid, fid, trid)

    This method is responsible to initialize the function required for
    profiling.
    This method is also responsible for storing the all functions data to
    session variable.
    This is only required for direct profiling. As Indirect profiling does
    not require these data because user will
    provide all the arguments and other functions information through another
    session to invoke the target.
    It will also create a unique transaction id and store the information
    into session variable.

    Parameters:
        node_type
        - Node type - Function or Procedure
        sid
        - Server Id
        did
        - Database Id
        scid
        - Schema Id
        fid
        - Function Id
        trid
        - Trigger Function Id
    """
    manager = get_driver(PG_DEFAULT_DRIVER).connection_manager(sid)
    conn = manager.connection(did=did)

    # Get the server version, server type and user information
    server_type = manager.server_type
    user = manager.user_info

    # Set the template path required to read the sql files
    template_path = 'profiler/sql'

    sql = ''

    if node_type == 'trigger':
        # Find trigger function id from trigger id
        sql = render_template(
            "/".join([template_path, 'get_trigger_function_info.sql']),
            table_id=fid, trigger_id=trid
        )

        status, tr_set = conn.execute_dict(sql)
        if not status:
            current_app.logger.debug(
                "Error retrieving trigger function information from database")
            return internal_server_error(errormsg=tr_set)

        fid = tr_set['rows'][0]['tgfoid']

    sql = render_template(
        "/".join([template_path, 'get_function_profile_info.sql']),
        is_ppas_database=False, # edb/other packages not supported fo rnow
        hasFeatureFunctionDefaults=True,
        fid=fid,
        is_proc_supported=False # procedures not supported for now
    )

    status, r_set = conn.execute_dict(sql)
    if not status:
        current_app.logger.debug(
            "Error retrieving function information from database")
        return internal_server_error(errormsg=r_set)

    ret_status = status

    # TODO: error checking (e.g. checking if extension is installed)

    # Return the response that function cannot be profiled...
    if not ret_status:
        current_app.logger.debug(msg)
        return internal_server_error(msg)

    data = {'name': r_set['rows'][0]['proargnames'],
            'type': r_set['rows'][0]['proargtypenames'],
            'use_default': r_set['rows'][0]['pronargdefaults'],
            'default_value': r_set['rows'][0]['proargdefaults'],
            'require_input': True}

    # Below will check do we really required for the user input arguments and
    # show input dialog
    if not r_set['rows'][0]['proargtypenames']:
        data['require_input'] = False
    else:
        if r_set['rows'][0]['pkg'] != 0 and \
                r_set['rows'][0]['pkgconsoid'] != 0:
            data['require_input'] = True

        if r_set['rows'][0]['proargmodes']:
            pro_arg_modes = r_set['rows'][0]['proargmodes'].split(",")
            for pr_arg_mode in pro_arg_modes:
                if pr_arg_mode == 'o' or pr_arg_mode == 't':
                    data['require_input'] = False
                    continue
                else:
                    data['require_input'] = True
                    break

    r_set['rows'][0]['require_input'] = data['require_input']

    # Create a profiler instance
    pfl_inst = ProfilerInstance()
    pfl_inst.function_data = {
        'oid': fid,
        'src': r_set['rows'][0]['prosrc'],
        'name': r_set['rows'][0]['name'],
        'is_func': r_set['rows'][0]['isfunc'],
        'is_ppas_database': ppas_server,
        'is_callable': False,
        'schema': r_set['rows'][0]['schemaname'],
        'language': r_set['rows'][0]['lanname'],
        'return_type': r_set['rows'][0]['rettype'],
        'args_type': r_set['rows'][0]['proargtypenames'],
        'args_name': r_set['rows'][0]['proargnames'],
        'arg_mode': r_set['rows'][0]['proargmodes'],
        'use_default': r_set['rows'][0]['pronargdefaults'],
        'default_value': r_set['rows'][0]['proargdefaults'],
        'pkgname': r_set['rows'][0]['pkgname'],
        'pkg': r_set['rows'][0]['pkg'],
        'require_input': data['require_input'],
        'args_value': ''
    }

    return make_json_response(
        data=dict(
            profile_info=r_set['rows'],
            trans_id=pfl_inst.trans_id
        ),
        status=200
    )

@blueprint.route('/direct/<int:trans_id>', methods=['GET'], endpoint='direct')
#@login_required
def direct_new(trans_id):
    pfl_inst = ProfilerInstance(trans_id)

    # Return from the function if transaction id not found
    if pfl_inst.profiler_data is None:
        return make_json_response(data={'status': True})

    # if indirect profiling pass value 0 to client and for direct profiling
    # pass it to 1
    profile_type = 0 if pfl_inst.profiler_data['profile_type'] == 'indirect' else 1

    """
    Animations and transitions are not automatically GPU accelerated and by
    default use browser's slow rendering engine.
    We need to set 'translate3d' value of '-webkit-transform' property in
    order to use GPU.
    After applying this property under linux, Webkit calculates wrong position
    of the elements so panel contents are not visible.
    To make it work, we need to explicitly set '-webkit-transform' property
    to 'none' for .ajs-notifier, .ajs-message, .ajs-modal classes.

    This issue is only with linux runtime application and observed in Query
    tool and debugger. When we open 'Open File' dialog then whole Query-tool
    panel content is not visible though it contains HTML element in back end.

    The port number should have already been set by the runtime if we're
    running in desktop mode.
    """
    is_linux_platform = False

    from sys import platform as _platform
    if "linux" in _platform:
        is_linux_platform = True

    # We need client OS information to render correct Keyboard shortcuts
    # TODO: keyboard shortcuts
    user_agent = UserAgent(request.headers.get('User-Agent'))

    function_arguments = '('
    if pfl_inst.profiler_data is not None:
        if 'args_name' in pfl_inst.profiler_data and \
            pfl_inst.profiler_data['args_name'] is not None and \
                pfl_inst.profiler_data['args_name'] != '':
            args_name_list = pfl_inst.profiler_data['args_name'].split(",")
            args_type_list = pfl_inst.profiler_data['args_type'].split(",")
            index = 0
            for args_name in args_name_list:
                function_arguments = '{}{} {}, '.format(function_arguments,
                                                        args_name,
                                                        args_type_list[index])
                index += 1
            # Remove extra comma and space from the arguments list
            if len(args_name_list) > 0:
                function_arguments = function_arguments[:-2]

    function_arguments += ')'

    layout = get_setting('Profiler/Layout')

    function_name_with_arguments = \
        pfl_inst.profiler_data['function_name'] + function_arguments

    return render_template(
        "profiler/direct.html",
        _=gettext,
        function_name=pfl_inst.profiler_data['function_name'],
        uniqueId=trans_id,
        profile_type=profile_type,
        is_desktop_mode=current_app.PGADMIN_RUNTIME,
        is_linux=is_linux_platform,
        client_platform=user_agent.platform,
        function_name_with_arguments=function_name_with_arguments,
        layout=layout
    )

@blueprint.route(
    '/initialize_target/<profile_type>/<int:trans_id>/<int:sid>/<int:did>/'
    '<int:scid>/<int:func_id>',
    methods=['GET', 'POST'],
    endpoint='initialize_target_for_function'
)
@blueprint.route(
    '/initialize_target/<profile_type>/<int:trans_id>/<int:sid>/<int:did>/'
    '<int:scid>/<int:func_id>/<int:tri_id>',
    methods=['GET', 'POST'],
    endpoint='initialize_target_for_trigger'
)
@login_required
def initialize_target(profile_type, trans_id, sid, did,
                      scid, func_id, tri_id=None):
    """
    initialize_target(profile_type, sid, did, scid, func_id, tri_id)

    This method is responsible for creating an asynchronous connection.

    Parameters:
        profile_type
        - Type of profiling (Direct or Indirect)
        sid
        - Server Id
        did
        - Database Id
        scid
        - Schema Id
        func_id
        - Function Id
        tri_id
        - Trigger Function Id
    """

    # Create asynchronous connection using random connection id.
    conn_id = str(random.randint(1, 9999999))
    try:
        manager = get_driver(PG_DEFAULT_DRIVER).connection_manager(sid)
        conn = manager.connection(did=did, conn_id=conn_id)
    except Exception as e:
        return internal_server_error(errormsg=str(e))

    # Connect the Server
    status, msg = conn.connect()
    if not status:
        return internal_server_error(errormsg=str(msg))

    user = manager.user_info

    status_in, rid_pre = conn.execute_scalar("SHOW shared_preload_libraries")
    if not status_in:
        return internal_server_error(
            gettext("Could not fetch profiler plugin information.")
        )

    # Need to check if plugin is really loaded or not with "plprofiler" string
    if profile_type == 'indirect':
        if "plprofiler" not in rid_pre:
            msg = gettext(
                "The profiler plugin is not enabled. "
                "Please add the plugin to the shared_preload_libraries "
                "setting in the postgresql.conf file and restart the "
                "database server for indirect profiling."
            )
            current_app.logger.debug(msg)
            return internal_server_error(msg)

    # Need to check if plugin is not loaded or not with "plprofiler" string
    if profile_type == 'direct':
        if "plprofiler" in rid_pre:
            msg = gettext(
                "The profiler plugin is enabled globally. "
                "Please remove the plugin to the shared_preload_libraries "
                "setting in the postgresql.conf file and restart the "
                "database server for direct profiling."
            )
            current_app.logger.debug(msg)
            return internal_server_error(msg)


    # Set the template path required to read the sql files
    template_path = 'profiler/sql'

    if tri_id is not None:
        # Find trigger function id from trigger id
        sql = render_template(
            "/".join([template_path, 'get_trigger_function_info.sql']),
            table_id=func_id, trigger_id=tri_id
        )

        status, tr_set = conn.execute_dict(sql)
        if not status:
            current_app.logger.debug(
                "Error retrieving trigger function information from database")
            return internal_server_error(errormsg=tr_set)

        func_id = tr_set['rows'][0]['tgfoid']

    pfl_inst = ProfilerInstance(trans_id)
    if request.method == 'POST':
        data = json.loads(request.values['data'], encoding='utf-8')
        if data:
            pfl_inst.function_data['args_value'] = data

    pfl_inst.profiler_data = {
        'conn_id': conn_id,
        'server_id': sid,
        'database_id': did,
        'schema_id': scid,
        'function_id': func_id,
        'function_name': pfl_inst.function_data['name'],
        'profile_type': profile_type,
        'profiler_version': 1.0, # Placeholder
        'restart_profile': 0
    }

    pfl_inst.update_session()

    return make_json_response(data={'status': status,
                                    'profilerTransId': trans_id})

@blueprint.route(
    '/start_listener/<int:trans_id>', methods=['GET', 'POST'],
    endpoint='start_listener'
)
@login_required
def start_profiler_listener(trans_id):
    """
    start_profiler_listener(trans_id)

    This method is responsible to listen and get the required information
    requested by user during profiling. It will also reset local data.

    Parameters:
        trans_id
        - Transaction ID
    """
    pfl_inst = ProfilerInstance(trans_id)
    if pfl_inst.profiler_data is None:
        return make_json_response(
            data={
                'status': 'NotConnected',
                'result': gettext(
                    'Not connected to server or connection with the server '
                    'has been closed.'
                )
            }
        )

    driver = get_driver(PG_DEFAULT_DRIVER)
    manager = driver.connection_manager(pfl_inst.profiler_data['server_id'])
    conn = manager.connection(
        did=pfl_inst.profiler_data['database_id'],
        conn_id=pfl_inst.profiler_data['conn_id'])

    ver = manager.version
    server_type = manager.server_type

    if conn.connected():
        if pfl_inst.profiler_data['profile_type'] == 'direct':
            sql = 'SET search_path to ' + pfl_inst.function_data['schema'] + ';'
            conn.execute_async(sql)
            sql = 'SELECT pl_profiler_reset_local();'
            status, result = conn.execute_async(sql)
            conn.execute_async('RESET search_path')
            if not status:
                return internal_server_error(errormsg=result)

    else:
        status = False
        result = gettext(
            'Not connected to server or connection with the server has '
            'been closed.'
        )

    return make_json_response(data={'status': status, 'result': result})

@blueprint.route(
    '/start_execution/<int:trans_id>/<int:port_num>', methods=['GET'],
    endpoint='start_execution'
)
@login_required
def start_execution(trans_id, port_num):
    """
    start_execution(trans_id, port_num)

    This method is responsible for creating an asynchronous connection for
    execution thread. Also store the session id into session return with
    attach port query for the indirect profiling.

    Parameters:
        trans_id
        - Transaction ID
        port_num TODO: Check if this is still necessary
        - Port number to attach
    """

    pfl_inst = ProfilerInstance(trans_id)
    if pfl_inst.profiler_data is None:
        return make_json_response(
            data={
                'status': 'NotConnected',
                'result': gettext(
                    'Not connected to server or connection with the server '
                    'has been closed.'
                )
            }
        )

    # Create asynchronous connection using random connection id.
    exe_conn_id = str(random.randint(1, 9999999))
    try:
        manager = get_driver(PG_DEFAULT_DRIVER).connection_manager(
            pfl_inst.profiler_data['server_id'])
        conn = manager.connection(
            did=pfl_inst.profiler_data['database_id'],
            conn_id=exe_conn_id)
    except Exception as e:
        return internal_server_error(errormsg=str(e))

    # Connect the Server
    status, msg = conn.connect()
    if not status:
        return internal_server_error(errormsg=str(msg))

    # find the debugger version and execute the query accordingly
    pfl_version = 1.0 # TODO: determine profiler version, there is plprofiler function for this

    # Render the sql to run the function/procedure here
    func_name = pfl_inst.function_data['name']
    func_args = pfl_inst.function_data['args_value']
    sql = 'SELECT * FROM ' + func_name + '('
    for arg_idx in range(len(func_args)):
        sql += str(func_args[arg_idx]['type']) + ' '
        sql += '\'' + str(func_args[arg_idx]['value']) + '\''
        if (arg_idx < len(func_args) - 1):
            sql += ', '
    sql += ');'

    report_name = func_name

    conn.execute_async('SET search_path to ' + pfl_inst.function_data['schema'] + ';')
    conn.execute_async('SELECT pl_profiler_set_enabled_local(true)')
    conn.execute_async('SELECT pl_profiler_set_collect_interval(0)')
    status, result = conn.execute_async_list(sql)
    conn.execute_async('SELECT pl_profiler_set_enabled_local(false)')
    report_data = generate_direct_report(conn, report_name, opt_top=10, func_oids={}) # TODO: Add support for K top
    report_id = save_direct_report(report_data, report_name, pfl_inst.function_data['schema'])
    conn.execute_async('RESET search_path')

    columns = {}

    # TODO: Test functionality for multiple return values
    for res in result:
        for key in res:
            columns['name'] = key

    return make_json_response(
        data={
            'status': 'Success',
            'result':  result,
            'col_info': [columns],
            'report_id'  : report_id
        }
    )

@blueprint.route(
    '/show_report/<int:report_id>', methods=['GET'],
    endpoint='show_report'
)
@login_required
def show_report(report_id):
    """
    show_report(report_id)

    Parameters:
        report_id
    """
    report_data = ProfilerSavedReports.query.filter_by(rid=report_id).first()
    path = str(current_app.root_path) + '/instance/direct/' + report_data.time + '.html'
    if report_data is None:
        pass
        # TODO: throw error

    with open(path, 'r') as f:
        report_data = f.read()

        # TODO: Put error checking in js when this method returns
        return Response(report_data, mimetype="text/html")

@blueprint.route(
    '/get_src/<int:trans_id>', methods=['GET'],
    endpoint='get_src'
)
@login_required
def get_src(trans_id):
    pfl_inst = ProfilerInstance(trans_id)
    if pfl_inst.profiler_data is None:
        return make_json_response(
            data={
                'status': 'NotConnected',
                'result': gettext(
                    'Not connected to server or connection with the server '
                    'has been closed.'
                )
            })

    return make_json_response(
        data={
            'status': 'Success',
            'result': pfl_inst.function_data['src']
        }
    )

def generate_direct_report(conn, name, opt_top, func_oids = None):
    """
    generate_report(trans_id)

    This method is used to generate an html report and save it in our sqlite database

    Parameters:
        conn

        name

        opt_top

        funco_oids
    """

    # ----
    # If not specified, find the top N functions by self time.
    # ----
    found_more_funcs = False
    if func_oids is None or len(func_oids) == 0:
        func_oids_by_user = False
        func_oids = []
        status, result = \
            conn.execute_async_list("""SELECT stack[array_upper(stack, 1)] as func_oid,
                                           sum(us_self) as us_self
                                       FROM pl_profiler_callgraph_local() C
                                       GROUP BY func_oid
                                       ORDER BY us_self DESC
                                       LIMIT %s""", (opt_top + 1, ))
        for row in result:
            func_oids.append(int(row['func_oid']))
        if len(func_oids) > opt_top:
            func_oids = func_oids[:-1]
            found_more_funcs = True
    else:
        func_oids_by_user = True
        func_oids = [int(x) for x in func_oids]

    if len(func_oids) == 0:
        # Possible causes of error:
        #   - No functions being profiled
        #   - Shared_preload_libraries contained the profiler
        raise Exception("No profiling data found")

    # ----
    # Get an alphabetically sorted list of the selected functions.
    # ----
    status, result = \
        conn.execute_async_list("""SELECT P.oid, N.nspname, P.proname
                                   FROM pg_catalog.pg_proc P
                                   JOIN pg_catalog.pg_namespace N ON N.oid = P.pronamespace
                                   WHERE P.oid IN (SELECT * FROM unnest(%s))
                                   ORDER BY upper(nspname), nspname,
                                            upper(proname), proname""", (func_oids, ))
    func_list = []
    for row in result:
        func_list.append({
                'funcoid':  str(row['oid']),
                'schema': str(row['nspname']),
                'funcname': str(row['proname']),
            })

    # ----
    # The view for linestats is extremely inefficient. We select
    # all of it once and cache it in a hash table.
    # ----
    linestats = {}
    status, result = \
        conn.execute_async_list("""SELECT L.func_oid, L.line_number,
                                   sum(L.exec_count)::bigint AS exec_count,
                                   sum(L.total_time)::bigint AS total_time,
                                   max(L.longest_time)::bigint AS longest_time,
                                   S.source
                               FROM pl_profiler_linestats_local() L
                               JOIN pl_profiler_funcs_source(pl_profiler_func_oids_local()) S
                                   ON S.func_oid = L.func_oid
                                   AND S.line_number = L.line_number
                               GROUP BY L.func_oid, L.line_number, S.source
                               ORDER BY L.func_oid, L.line_number""")
    for row in result:
        if row['func_oid'] not in linestats:
            linestats[row['func_oid']] = []
        linestats[row['func_oid']].append((row['func_oid'],
                                          int(row['line_number']),
                                          int(row['exec_count']),
                                          int(row['total_time']),
                                          int(row['longest_time']),
                                          row['source']))
    # ----
    # Build a list of function definitions in the order, specified
    # by the func_oids list. This is either the oids, requested by
    # the user or the oids determined above in descending order of
    # self_time.
    # ----
    func_defs = []
    for func_oid in func_oids:
        # ----
        # First get the function definition and overall stats.
        # ----
        status, result = \
            conn.execute_async_list("""WITH SELF AS (SELECT
                                               stack[array_upper(stack, 1)] as func_oid,
                                                   sum(us_self) as us_self
                                               FROM pl_profiler_callgraph_local()
                                               GROUP BY func_oid)
                                       SELECT P.oid, N.nspname, P.proname,
                                           pg_catalog.pg_get_function_result(P.oid),
                                           pg_catalog.pg_get_function_arguments(P.oid),
                                           coalesce(SELF.us_self, 0) as self_time
                                           FROM pg_catalog.pg_proc P
                                           JOIN pg_catalog.pg_namespace N ON N.oid = P.pronamespace
                                           LEFT JOIN SELF ON SELF.func_oid = P.oid
                                           WHERE P.oid = %s""", (func_oid, ))
        row = result[0]
        if row is None:
            raise Exception("function with Oid %d not found\n" %func_oid)

        # ----
        # With that we can start the definition.
        # ----
        func_def = {
                'funcoid': func_oid,
                'schema': row['nspname'],
                'funcname': row['proname'],
                'funcresult': row['pg_get_function_result'],
                'funcargs': row['pg_get_function_arguments'],
                'total_time': linestats[func_oid][0][3],
                'self_time': int(row['self_time']),
                'source': [],
            }

        # ----
        # Add all the source code lines to that.
        # ----
        for row in linestats[func_oid]:
            func_def['source'].append({
                    'line_number': int(row[1]),
                    'source': row[5],
                    'exec_count': int(row[2]),
                    'total_time': int(row[3]),
                    'longest_time': int(row[4]),
                })

        # ----
        # Add this function to the list of function definitions.
        # ----
        func_defs.append(func_def)

    # ----
    # Get the callgraph data.
    # ----
    status, result = \
        conn.execute_async_list("""SELECT
                                           array_to_string(pl_profiler_get_stack(stack), ';'),
                                           stack,
                                           call_count,
                                           us_total,
                                           us_children,
                                           us_self
                        FROM pl_profiler_callgraph_local()""")
    flamedata = ""
    callgraph = []
    for row in result:
        flamedata += str(row['array_to_string']) + " " + str(row['us_self']) + "\n"
        callgraph.append([row['stack'], row['call_count'], row['call_count'], row['us_total'], row['us_children'], row['us_self']])


    return {
            'config': {
                       'name': name,
                       'title': 'PL Profiler Report for %s' %(name, ),
                       'tabstop': '8',
                       'svg_width': '1200',
                       'table_width': '80%',
                       'desc': '<h1>PL Profiler Report for %s</h1>\n' %(name, ) +
                               '<p>\n<!-- description here -->\n</p>'
                      },
            'callgraph_overflow': False,
            'functions_overflow': False,
            'lines_overflow': False,
            'func_list': func_list,
            'func_defs': func_defs,
            'flamedata': flamedata,
            'callgraph': callgraph,
            'func_oids_by_user': func_oids_by_user,
            'found_more_funcs': found_more_funcs,
        }

def save_direct_report(report_data, name, dbname):
    """
    save_direct_report(report_data, name, dbname)

    Parameters:
        TODO
    """
    now = datetime.now().strftime("%Y-%m-%d;%H:%M")
    path = '/instance/direct/' + now + '.html'

    with open(str(current_app.root_path) + path, 'w') as output_fd:
        report = plprofiler_report.plprofiler_report()
        report.generate(report_data, output_fd)

        output_fd.close()

        profile_report = ProfilerSavedReports(
            name = name,
            direct = True,
            dbname = dbname,
            time = now
        )

        db.session.add(profile_report)

        db.session.commit()

        return profile_report.rid

@blueprint.route(
    '/get_parameters/<int:trans_id>', methods=['GET'],
    endpoint='get_parameters'
)
@login_required
def get_parameters(trans_id):
    pfl_inst = ProfilerInstance(trans_id)
    if pfl_inst.profiler_data is None:
        return make_json_response(
            data={
                'status': 'NotConnected',
                'result': gettext(
                    'Not connected to server or connection with the server '
                    'has been closed.'
                )
            }
        )

    arg_values = pfl_inst.function_data['args_value']

    return make_json_response(
        data={
            'status': 'Success',
            'result': arg_values
        }
    )

@blueprint.route(
    '/get_arguments/<int:sid>/<int:did>/<int:scid>/<int:func_id>',
    methods=['GET'], endpoint='get_arguments'
)
@login_required
def get_arguments_sqlite(sid, did, scid, func_id):
    """
    get_arguments_sqlite(sid, did, scid, func_id)

    This method is responsible to get the function arguments saved to sqlite
    database during first debugging.

    Parameters:
        sid
        - Server Id
        did
        - Database Id
        scid
        - Schema Id
        func_id
        - Function Id
    """
    PflFuncArgsCount = ProfilerFunctionArguments.query.filter_by(
        server_id=sid,
        database_id=did,
        schema_id=scid,
        function_id=func_id
    ).count()

    args_data = []

    if PflFuncArgsCount:
        """Update the Profiler Function Arguments settings"""
        PflFuncArgs = ProfilerFunctionArguments.query.filter_by(
            server_id=sid,
            database_id=did,
            schema_id=scid,
            function_id=func_id
        )

        args_list = PflFuncArgs.all()

        for i in range(0, PflFuncArgsCount):
            info = {
                "arg_id": args_list[i].arg_id,
                "is_null": args_list[i].is_null,
                "is_expression": args_list[i].is_expression,
                "use_default": args_list[i].use_default,
                "value": args_list[i].value
            }
            args_data.append(info)

        # As we do have entry available for that function so we need to add
        # that entry
        return make_json_response(
            data={'result': args_data, 'args_count': PflFuncArgsCount}
        )
    else:
        # As we do not have any entry available for that function so we need
        # to add that entry
        return make_json_response(
            data={'result': 'result', 'args_count': PflFuncArgsCount}
        )

@blueprint.route(
    '/set_arguments/<int:sid>/<int:did>/<int:scid>/<int:func_id>',
    methods=['POST'], endpoint='set_arguments'
)
@login_required
def set_arguments_sqlite(sid, did, scid, func_id):
    """
    set_arguments_sqlite(sid, did, scid, func_id)

    This method is responsible for setting the value of function arguments
    to sqlite database

    Parameters:
        sid
        - Server Id
        did
        - Database Id
        scid
        - Schema Id
        func_id
        - Function Id
    """

    if request.values['data']:
        data = json.loads(request.values['data'], encoding='utf-8')

    try:
        for i in range(0, len(data)):
            PflFuncArgsExists = ProfilerFunctionArguments.query.filter_by(
                server_id=data[i]['server_id'],
                database_id=data[i]['database_id'],
                schema_id=data[i]['schema_id'],
                function_id=data[i]['function_id'],
                arg_id=data[i]['arg_id']
            ).count()

            # handle the Array list sent from the client
            array_string = ''
            if 'value' in data[i]:
                if data[i]['value'].__class__.__name__ in (
                        'list') and data[i]['value']:
                    for k in range(0, len(data[i]['value'])):
                        if data[i]['value'][k]['value'] is None:
                            array_string += 'NULL'
                        else:
                            array_string += str(data[i]['value'][k]['value'])
                        if k != (len(data[i]['value']) - 1):
                            array_string += ','
                elif data[i]['value'].__class__.__name__ in (
                        'list') and not data[i]['value']:
                    array_string = ''
                else:
                    array_string = data[i]['value']

            # Check if data is already available in database then update the
            # existing value otherwise add the new value
            if PflFuncArgsExists:
                PflFuncArgs = ProfilerFunctionArguments.query.filter_by(
                    server_id=data[i]['server_id'],
                    database_id=data[i]['database_id'],
                    schema_id=data[i]['schema_id'],
                    function_id=data[i]['function_id'],
                    arg_id=data[i]['arg_id']
                ).first()

                PflFuncArgs.is_null = data[i]['is_null']
                PflFuncArgs.is_expression = data[i]['is_expression']
                PflFuncArgs.use_default = data[i]['use_default']
                PflFuncArgs.value = array_string
            else:
                profiler_func_args = ProfilerFunctionArguments(
                    server_id=data[i]['server_id'],
                    database_id=data[i]['database_id'],
                    schema_id=data[i]['schema_id'],
                    function_id=data[i]['function_id'],
                    arg_id=data[i]['arg_id'],
                    is_null=data[i]['is_null'],
                    is_expression=data[i]['is_expression'],
                    use_default=data[i]['use_default'],
                    value=array_string
                )

                db.session.add(profiler_func_args)

            db.session.commit()

    except Exception as e:
        current_app.logger.exception(e)
        return make_json_response(
            status=410,
            success=0,
            errormsg=e.message
        )

    return make_json_response(data={'status': True, 'result': 'Success'})

@blueprint.route(
    '/get_reports', methods=['GET'],
    endpoint='get_reports'
)
@login_required
def get_reports():
    saved_reports = ProfilerSavedReports.query.all()

    reports = []
    for report in saved_reports:
        reports.append({'name' : report.name,
                        'database' : report.dbname,
                        'time' : report.time,
                        'profile_type' : report.direct,
                        'report_id' : report.rid})


    return make_json_response(
        data={
            'status': 'Success',
            'result': reports
        }
    )

@blueprint.route(
    '/poll_result/<int:trans_id>/', methods=["GET"], endpoint='poll_result'
)
@login_required
def poll_result(trans_id):
    """
    poll_result(trans_id)

    This method polls the result of the asynchronous query and returns the
    result.

    Parameters:
        trans_id
        - unique transaction id.
    """
    pfl_inst = ProfilerInstance(trans_id)
    if pfl_inst.profiler_data is None:
        return make_json_response(
            data={
                'status': 'NotConnected',
                'result': gettext(
                    'Not connected to server or connection with the server '
                    'has been closed.'
                )
            }
        )

    manager = driver.connection_manager(pfl_inst.profiler_data['server_id'])
    conn = manager.connection(
        did=pfl_inst.profiler_data['database_id'],
        conn_id=pfl_inst.profiler_data['conn_id'])

    if conn.connected():
        status, result = conn.poll()
        if not status:
            status = 'ERROR'
        elif status == ASYNC_OK and result is not None:
            status = 'Success'
            columns, result = convert_data_to_dict(conn, result)
        else:
            status = 'Busy'
    else:
        status = 'NotConnected'
        result = gettext(
            'Not connected to server or connection with the server '
            'has been closed.'
        )

    return make_json_response(
        data={
            'status': status,
            'result': result
        }
    )




@blueprint.route(
    '/close/<int:trans_id>', methods=["DELETE"], endpoint='close'
)
def close(trans_id):
    """
    close(trans_id)

    This method is used to close the asynchronous connection
    and remove the information of unique transaction id from
    the session variable.

    Parameters:
        trans_id
        - unique transaction id.
    """

    close_profiler_session(trans_id)
    return make_json_response(data={'status': True})

def close_profiler_session(_trans_id, close_all=False):
    """
    This function is used to cancel the profiler transaction and
    release the connection.

    :param trans_id: Transaction id
    :return:
    """

    if close_all:
        trans_ids = ProfilerInstance.get_trans_ids()
    else:
        trans_ids = [_trans_id]

    for trans_id in trans_ids:
        pfl_inst = ProfilerInstance(trans_id)
        pfl_obj = pfl_inst.profiler_data

        try:
            if pfl_obj is not None:
                manager = get_driver(PG_DEFAULT_DRIVER).\
                    connection_manager(pfl_obj['server_id'])

                if manager is not None:
                    conn = manager.connection(
                        did=pfl_obj['database_id'],
                        conn_id=pfl_obj['conn_id'])
                    if conn.connected():
                        conn.cancel_transaction(
                            pfl_obj['conn_id'],
                            pfl_obj['database_id'])
                    manager.release(conn_id=pfl_obj['conn_id'])

                    if 'exe_conn_id' in pfl_obj:
                        conn = manager.connection(
                            did=pfl_obj['database_id'],
                            conn_id=pfl_obj['exe_conn_id'])
                        if conn.connected():
                            conn.cancel_transaction(
                                pfl_obj['exe_conn_id'],
                                pfl_obj['database_id'])
                        manager.release(conn_id=pfl_obj['exe_conn_id'])
        except Exception as _:
            raise
        finally:
            pfl_inst.clear()
