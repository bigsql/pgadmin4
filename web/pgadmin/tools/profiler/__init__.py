####################################################################################################
#
#
# Todo: implement support for procedures
#
#
#
####################################################################################################

"""A blueprint module implementing the profiler"""

MODULE_NAME = 'profiler'

import simplejson as json
import random
from datetime import datetime
import time
import os

from flask import url_for, Response, render_template, request, session, \
    current_app
from flask_babelex import gettext
from flask_security import login_required
from werkzeug.useragents import UserAgent

from pgadmin.utils import PgAdminModule, \
    SHORTCUT_FIELDS as shortcut_fields,  \
    ACCESSKEY_FIELDS as accesskey_fields
from pgadmin.utils.ajax import bad_request
from pgadmin.utils.ajax import make_json_response, \
    internal_server_error
from pgadmin.utils.driver import get_driver
from pgadmin.settings import get_setting

from config import PG_DEFAULT_DRIVER
from pgadmin.model import db, ProfilerSavedReports, ProfilerFunctionArguments
from pgadmin.tools.profiler.utils.profiler_instance import ProfilerInstance
from pgadmin.tools.profiler.utils.profiler_report import plprofiler_report

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
            ['pgadmin.tools.profiler.profile', 'js/profile']
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

        self.top_k = self.preference.register(
            'Properties', 'profiler_top_k',
            gettext("Number of functions to report for"), 'integer', 10,
            category_label=gettext('Properties'),
            help_str=gettext('The profiler will generate a report for the given number '
                             'of functions')
        )

    # TODO: Keyboard shortcuts

    def get_exposed_url_endpoints(self):
        return ['profiler.index','profiler.profile',
                'profiler.init_for_database', 'profiler.init_for_function',
                'profiler.initialize_target_for_function', 'profiler.initialize_target_indirect',
                'profiler.start_monitor', 'profiler.start_execution',
                'profiler.show_report', 'profiler.delete_report',
                'profiler.get_src', 'profiler.get_parameters', 'profiler.get_reports',
                'profiler.set_arguments', 'profiler.get_arguments',
                'profiler.set_config', 'profiler.get_config',
                'profiler.close', 'profiler.get_duration'
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
    """Render the main profiler javascript file"""
    return Response(
        response=render_template("profiler/js/profiler.js", _=gettext),
        status=200,
        mimetype="application/javascript"
    )

@blueprint.route("/js/profiler_ui.js")
@login_required
def script_profiler_js():
    """Render the profiler UI javascript file"""
    return Response(
        response=render_template("profiler/js/profiler_ui.js", _=gettext),
        status=200,
        mimetype="application/javascript"
    )


@blueprint.route("/js/profile.js")
@login_required
def script_profiler_direct_js():
    """
    Render the javascript file required send and receive the response
    from server for profiling
    """
    return Response(
        response=render_template("profiler/js/profile.js", _=gettext),
        status=200,
        mimetype="application/javascript"
    )

####################################################################################################

@blueprint.route(
    '/init/<node_type>/<int:sid>/<int:did>',
    methods=['GET'], endpoint='init_for_database'
)
@blueprint.route(
    '/init/<node_type>/<int:sid>/<int:did>/<int:scid>/<int:fid>',
    methods=['GET'], endpoint='init_for_function'
)
@login_required
def init_function(node_type, sid, did, scid=None, fid=None):
    """
    init_function(node_type, sid, did, scid, fid)

    This method is responsible to initialize the function required for
    profiling.
    This method is also responsible for storing the functions data to
    session variable.
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
    Returns:
        JSON response for the client with information about profiling instance
        and the transaction id
    """
    manager = get_driver(PG_DEFAULT_DRIVER).connection_manager(sid)
    conn = manager.connection(did=did)

    # Determine profiling type
    profile_type = ''
    if node_type.strip() == 'database':
        profile_type = 'indirect'

    # Get the server version, server type and user information
    server_type = manager.server_type
    user = manager.user_info

    if profile_type is 'indirect':
        pfl_inst = ProfilerInstance()

        # No function data because we are not running a function to profile
        pfl_inst.function_data = {}

        return make_json_response(
            data=dict(
                db_info={
                    'sid' : sid,
                    'did' : did
                },
                trans_id=pfl_inst.trans_id
            ),
            status=200
        )

    else:
        # Set the template path required to read the sql files
        template_path = 'profiler/sql'

        sql = ''

        sql = render_template(
            "/".join([template_path, 'get_function_profile_info.sql']),
            is_ppas_database=False, # edb/other packages not supported currently
            hasFeatureFunctionDefaults=True,
            fid=fid,
            is_proc_supported=False # procedures not supported currently
        )

        status, r_set = conn.execute_dict(sql)
        if not status:
            current_app.logger.debug(
                "Error retrieving function information from database")
            return internal_server_error(errormsg=r_set)

        ret_status = status

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
            'is_ppas_database': False,
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
            'args_value': '',
            'node_type': node_type
        }

        return make_json_response(
            data=dict(
                profile_info=r_set['rows'],
                trans_id=pfl_inst.trans_id
            ),
            status=200
        )

@blueprint.route('/profile/<int:trans_id>', methods=['GET'], endpoint='profile')
@login_required
def profile_new(trans_id):
    """
    This method is responsible for creating an asynchronous connection
    for direct profiling.

    Parameters:
        trans_id
        - The unique transaction id that corresponds with the previously initialized
          profiler instance
    Returns: Generated html template with the new window to start profiling
    """
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
    user_agent = UserAgent(request.headers.get('User-Agent'))

    if profile_type == 1:
        function_name = pfl_inst.profiler_data['function_name']

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

        function_name_with_arguments = \
            pfl_inst.profiler_data['function_name'] + function_arguments

    else:
        function_name = "Indirect"
        function_name_with_arguments = "Indirect"

    layout = get_setting('Profiler/Layout')

    return render_template(
        "profiler/profiler_window.html",
        _=gettext,
        function_name=function_name,
        uniqueId=trans_id,
        profile_type=profile_type,
        is_desktop_mode=current_app.PGADMIN_RUNTIME,
        is_linux=is_linux_platform,
        client_platform=user_agent.platform,
        function_name_with_arguments=function_name_with_arguments,
        layout=layout
    )

@blueprint.route(
    '/initialize_target_indirect/<profile_type>/<int:trans_id>/<int:sid>/<int:did>/',
    methods=['GET', 'POST'],
    endpoint='initialize_target_indirect'
)
@login_required
def initialize_target_indirect(profile_type, trans_id, sid, did):
    """
    This method is responsible for creating an asynchronous connection
    for indirect profiling.

    Parameters:
        profile_type
        - Type of profiling (Direct or Indirect)
        trans_id
        - The unique transaction id for a profiler instance
        sid
        - Server Id
        did
        - Database Id
        scid
        - Schema Id
    Returns:
        JSON response with the transaciton id
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

    pfl_inst = ProfilerInstance(trans_id)
    if request.method == 'POST':
        data = json.loads(request.values['data'], encoding='utf-8')

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

    # Input checking
    try:
        pfl_inst.profiler_data = {
            'duration' : data[0]['value'],
            'interval' : data[1]['value'],
            'pid'      : data[2]['value']
        }
    except Exception as e:
        return make_json_response(
            data={
                'status' : 'ERROR',
                'result' : 'Invalid input type'
            }
        )

    pfl_inst.profiler_data['conn_id'] = conn_id
    pfl_inst.profiler_data['sid'] = sid
    pfl_inst.profiler_data['did'] = did
    pfl_inst.profiler_data['function_name'] = 'Indirect'
    pfl_inst.profiler_data['profile_type'] = 'indirect'
    pfl_inst.profiler_data['restart_profile'] = 0

    pfl_inst.config = {
        'name': 'Indirect',
        'title': 'Pl/Profiler Report for ' + conn.as_dict()['database'],
        'tabstop': '8',
        'svg_width': '1200',
        'table_width': '80%',
        'desc': ''
    }

    pfl_inst.update_session()

    return make_json_response(data={'status': status,
                                    'profilerTransId': trans_id})

@blueprint.route(
    '/initialize_target/<profile_type>/<int:trans_id>/<int:sid>/<int:did>/'
    '<int:scid>/<int:func_id>',
    methods=['GET', 'POST'],
    endpoint='initialize_target_for_function'
)
@login_required
def initialize_target(profile_type, trans_id, sid, did,
                      scid, func_id):
    """
    initialize_target(profile_type, sid, did, scid, func_id)

    This method is responsible for creating an asynchronous connection
    for direct profiling.

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
        'profile_type': 'direct',
        'function_id': func_id,
        'function_name': pfl_inst.function_data['name'],
        'profile_type': profile_type,
        'restart_profile': 0
    }

    pfl_inst.config = {
        'name': pfl_inst.function_data['name'],
        'title': 'Pl/Profiler Report for ' + pfl_inst.function_data['name'],
        'tabstop': '8',
        'svg_width': '1200',
        'table_width': '80%',
        'desc': ''
    }

    pfl_inst.update_session()

    return make_json_response(data={'status': status,
                                    'profilerTransId': trans_id})

@blueprint.route(
    '/start_monitor/<int:trans_id>', methods=['GET'],
    endpoint='start_monitor'
)
@login_required
def start_monitor(trans_id):
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

    duration = pfl_inst.profiler_data['duration']
    interval = pfl_inst.profiler_data['interval']
    pid      = pfl_inst.profiler_data['pid']

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

    status, res = conn.execute_async_list("""
                    SELECT N.nspname
                    FROM pg_catalog.pg_extension E
                    JOIN pg_catalog.pg_namespace N ON N.oid = E.extnamespace
                    WHERE E.extname = 'plprofiler'
                """)
    namespace = res[0]['nspname']

    try:
        conn.execute_async('SET search_path to ' + namespace)
        conn.execute_async('SELECT pl_profiler_reset_shared()')
        if (pid is not None and pid is not ''):
            conn.execute_async('SELECT pl_profiler_set_enable_pid(' + pid + ')')
        else:
            conn.execute_async('SELECT pl_profiler_set_enabled_global(true)')
        conn.execute_async('SELECT pl_profiler_set_collect_interval(' + interval + ')')
        conn.execute_async('RESET search_path')
        try:
            time.sleep(int(duration))
        finally:
            pass
    finally:
        conn.execute_async('SET search_path to ' + namespace)
        conn.execute_async('SELECT pl_profiler_set_enabled_global(false)')
        conn.execute_async('SELECT pl_profiler_set_enabled_pid(0)')
        conn.execute_async('RESET search_path')

    # At this point we have the data in shared memory and need to create a report from it
    report_data = generate_report(conn, 'shared', opt_top=10, func_oids={})
    save_report(report_data,
                pfl_inst.config,
                conn.as_dict()['database'],
                pfl_inst.profiler_data['profile_type'],
                int(pfl_inst.profiler_data['duration']))


    return make_json_response(
        data = {
            'status': 'Success'
        }
    )

@blueprint.route(
    '/start_execution/<int:trans_id>', methods=['GET'],
    endpoint='start_execution'
)
@login_required
def start_execution(trans_id):
    """
    start_execution(trans_id)

    This method is responsible for creating an asynchronous connection for
    execution thread. Also store the session id into session return with
    attach port query for the indirect profiling.

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

    # Render the sql to run the function/procedure here
    # TODO: convert into sql template
    func_name = pfl_inst.function_data['name']
    func_args = pfl_inst.function_data['args_value']
    sql = 'SELECT ' if pfl_inst.function_data['node_type'] == 'function' else 'CALL '
    sql = sql + func_name + '('
    for arg_idx in range(len(func_args)):
        sql += str(func_args[arg_idx]['type']) + ' '
        sql += '\'' + str(func_args[arg_idx]['value']) + '\''
        if (arg_idx < len(func_args) - 1):
            sql += ', '
    sql += ');'

    try:
        conn.execute_async('SET search_path to ' + pfl_inst.function_data['schema'] + ';')
        conn.execute_async('SELECT pl_profiler_set_enabled_local(true)')
        conn.execute_async('SELECT pl_profiler_reset_local()')
        conn.execute_async('SELECT pl_profiler_set_collect_interval(0)')
        status, result = conn.execute_async_list(sql)
        report_data = generate_report(conn, 'local', opt_top=10, func_oids={}) # TODO: Add support for K top
        report_id = save_report(report_data,
                                pfl_inst.config,
                                conn.as_dict()['database'],
                                pfl_inst.profiler_data['profile_type'],
                                -1)
        conn.execute_async('SELECT pl_profiler_set_enabled_local(false)')
        conn.execute_async('RESET search_path')
    except Exception as e:
        current_app.logger.exception(e)
        return make_json_response(
            data={
                'status': 'ERROR',
                'result': str(e),
            }
        )

    # Format the result to display the result to client
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

####################################################################################################
### Functions interacting with report manipulation #################################################
####################################################################################################
def generate_report(conn, data_location, opt_top, func_oids = None):
    """
    generate_report(trans_id)

    This method is used to generate an html report and save it in our sqlite database

    Parameters:
        conn
        - psycopg2 connection object to run queries on the server
        opt_top
        - The constant for which we will find the opt_top functions by time
        func_oids
        - Specific func_oids to profile for
        data_location
        - Either 'local' or 'shared', which is determined by the type of profiling
    Returns:
        dictionary containing information about the performance profile
    """

    # Set the template path required to read the sql files
    template_path = 'profiler/sql'

    # ----
    # If not specified, find the top N functions by self time.
    # ----
    found_more_funcs = False
    if func_oids is None or len(func_oids) == 0:
        func_oids_by_user = False
        func_oids = []


        sql = render_template(
            "/".join([template_path,
                      'get_func_oids.sql']),
            data_location=data_location,
            opt_top = opt_top
        )

        status, result = conn.execute_async_list(
        """SELECT stack[array_upper(stack, 1)] as func_oid,
                  sum(us_self) as us_self
           FROM pl_profiler_callgraph_""" + data_location + """() C
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
    sql = render_template(
        "/".join([template_path,
                  'sort_func_oids.sql']),
        func_oids=func_oids
    )
    status, result = conn.execute_async_list(sql);
    func_list = []
    for row in result:
        func_list.append({
                'funcname': str(row['proname']),
                'funcoid':  str(row['oid']),
                'schema': str(row['nspname']),
            })

    # ----
    # The view for linestats is extremely inefficient. We select
    # all of it once and cache it in a hash table.
    # ----
    sql = render_template(
        "/".join([template_path,
                  'get_linestats.sql']),
        data_location=data_location
    )

    linestats = {}
    status, result = conn.execute_async_list(sql);
    for row in result:
        if row['func_oid'] not in linestats:
            linestats[row['func_oid']] = []
        linestats[row['func_oid']].append((row['func_oid'],
                                          (row['line_number']),
                                          (row['exec_count']),
                                          (row['total_time']),
                                          (row['longest_time']),
                                          row['source']))

    # ----
    # Build a list of function definitions in the order, specified
    # by the func_oids list. This is either the oids, requested by
    # the user or the oids determined above in descending order of
    # self_time.
    # ----
    func_defs = []
    for func_oid in func_oids:
        sql = render_template(
            "/".join([template_path,
                      'get_func_defs.sql']),
            data_location=data_location,
            func_oid=func_oid
        )

        # ----
        # First get the function definition and overall stats.
        # ----
        status, result = conn.execute_async_list(sql)
        row = result[0]
        if row is None:
            raise Exception("function with Oid %d not found\n" %func_oid)

        # ----
        # With that we can start the definition.
        # ----
        func_def = {
                'funcoid'    : func_oid,
                'schema'     : row['nspname'],
                'funcname'   : row['proname'],
                'funcresult' : row['pg_get_function_result'],
                'funcargs'   : row['pg_get_function_arguments'],
                'total_time' : linestats[func_oid][0][3],
                'self_time'  : int(row['self_time']),
                'source'     : [],
            }

        # ----
        # Add all the source code lines to that.
        # ----
        for row in linestats[func_oid]:
            func_def['source'].append({
                    'line_number'  : int(row[1]),
                    'source'       : row[5],
                    'exec_count'   : int(row[2]),
                    'total_time'   : int(row[3]),
                    'longest_time' : int(row[4]),
                })

        # ----
        # Add this function to the list of function definitions.
        # ----
        func_defs.append(func_def)

    # ----
    # Get the callgraph data.
    # ----
    sql = render_template(
        "/".join([template_path,
                  'get_callgraph_data.sql']),
        data_location=data_location
    )
    status, result = conn.execute_async_list(sql)

    flamedata = ""
    callgraph = []
    for row in result:
        flamedata += str(row['array_to_string']) + " " + str(row['us_self']) + "\n"
        callgraph.append((row['stack'],
                          int(row['call_count']),
                          int(row['us_total']),
                          int(row['us_children']),
                          int(row['us_self'])))

    if data_location == 'shared':
        sql = render_template(
            "/".join([template_path,
                  'get_overflow_flags.sql'])
        )
        status, result = conn.execute_async_list(sql)
        overflow_flags = result[0]

    return {
            'callgraph_overflow' : False \
                if data_location == 'local' \
                else overflow_flags['pl_profiler_callgraph_overflow'],
            'functions_overflow' : False \
                if data_location == 'local' \
                else overflow_flags['pl_profiler_functions_overflow'],
            'lines_overflow' : False \
                if data_location == 'local' \
                else overflow_flags['pl_profiler_lines_overflow'],
            'func_list' : func_list,
            'func_defs' : func_defs,
            'flamedata' : flamedata,
            'callgraph' : callgraph,
            'func_oids_by_user': func_oids_by_user,
            'found_more_funcs' : found_more_funcs,
        }

def save_report(report_data, config, dbname, profile_type, duration):
    """
    save_report(report_data, config, dbname, profile_type)

    Parameters:
        report_data
        config
        dbname
        profile_type
    Returns
    """
    report_data['config'] = config


    now = datetime.now().strftime("%Y-%m-%d;%H:%M")
    path = os.path.dirname(os.path.abspath(current_app.root_path))
    path = os.path.join(path, 'pgadmin', 'instance', config['name'] + '@' + now + '.html')

    report = ProfilerSavedReports.query.filter_by(path=path).first()

    # To prevent duplicate reports with the same filename
    # This would happen if the same profile was run multiple times in a minute
    version = ''
    while report is not None:
        if version == '':
            version = 'a'
        else:
            version = chr(ord(path[-5][-1]) + 1)

        path = path[-5] + version + '.html'
        report = ProfilerSavedReports.query.filter_by(path=path).first()

    try:
        with open(path, 'w') as output_fd:
            report = plprofiler_report()
            report.generate(report_data, output_fd)

            output_fd.close()

            profile_report = ProfilerSavedReports(
                name     = config['name'],
                direct   = False if profile_type == 'indirect' else True,
                dbname   = dbname,
                time     = now,
                duration = duration,
                path     = path
            )

            db.session.add(profile_report)
            db.session.commit()

            return profile_report.rid
    except Exception as e:
        current_app.logger.exception(e)
        os.remove(path)


@blueprint.route(
    '/delete_report/<int:report_id>', methods=['POST'],
    endpoint='delete_report'
)
@login_required
def delete_report(report_id):
    """
    delete_report(report_id)

    Parameters:
        report_id
    Returns:
    """
    report = ProfilerSavedReports.query.filter_by(rid=report_id).first()

    if report is None:
        raise Exception('No report with given report_id found')

    path = report.path
    try:
        db.session.delete(report)
        db.session.commit()

        os.remove(path)
        return make_json_response(
            data={
                'status' : 'Success'
            }
        )
    except Exception as e:
        current_app.logger.exception(e)
        return make_json_response(
            data={
                'status': 'ERROR',
                'result': str(e)
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
    Returns:
    """
    report = ProfilerSavedReports.query.filter_by(rid=report_id).first()

    path = report.path

    if report is None:
        raise Exception('PgAdmin4 could not find the specified report')
    if not os.path.exists(path):
        raise Exception('The selected report could not be found by PgAdmin4')

    with open(path, 'r') as f:
        report_data = f.read()

        return Response(report_data, mimetype="text/html")

####################################################################################################
### Functions interacting with internal PgAdmin4 sqlite3 database ##################################
####################################################################################################
@blueprint.route(
    '/get_arguments/<int:sid>/<int:did>/<int:scid>/<int:func_id>',
    methods=['GET'], endpoint='get_arguments'
)
@login_required
def get_arguments_sqlite(sid, did, scid, func_id):
    """
    get_arguments_sqlite(sid, did, scid, func_id)

    This method is responsible to get the function arguments saved to sqlite
    database during profiling

    Parameters:
        sid
        - Server Id
        did
        - Database Id
        scid
        - Schema Id
        func_id
        - Function Id
    Returns:
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
            data={
                'result': args_data,
                'args_count': PflFuncArgsCount}
        )
    else:
        # As we do not have any entry available for that function so we need
        # to add that entry
        return make_json_response(
            data={
                'result': 'result',
                'args_count': PflFuncArgsCount}
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
    Returns:

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

####################################################################################################
### Functions that provide information for the client-side panels ##################################
####################################################################################################
@blueprint.route(
    '/get_src/<int:trans_id>', methods=['GET'],
    endpoint='get_src'
)
@login_required
def get_src(trans_id):
    """

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
            })

    return make_json_response(
        data={
            'status': 'Success',
            'result': pfl_inst.function_data['src']
        }
    )

@blueprint.route(
    '/get_parameters/<int:trans_id>', methods=['GET'],
    endpoint='get_parameters'
)
@login_required
def get_parameters(trans_id):
    """
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

    if pfl_inst.profiler_data['profile_type'] == 'direct':
        return make_json_response(
            data={
                'status': 'Success',
                'result': pfl_inst.function_data['args_value']
            }
        )

    else: # profile type is indirect
        return make_json_response(
            data={
                'status': 'Success',
                'result': [
                    {'name'  : 'Duration',
                     'type'  : 'Monitoring Parameter',
                     'value' : pfl_inst.profiler_data['duration']},
                    {'name'  : 'Interval',
                     'type'  : 'Monitoring Parameter',
                     'value' : pfl_inst.profiler_data['interval']},
                    {'name'  : 'PID',
                     'type'  : 'Monitoring Parameter',
                     'value' : pfl_inst.profiler_data['pid'] \
                               if pfl_inst.profiler_data['pid'] != 'No PID specified' \
                               else pfl_inst.profiler_data['pid']}
                ]
            }
        )

@blueprint.route(
    '/get_reports', methods=['GET'],
    endpoint='get_reports'
)
@login_required
def get_reports():
    """
    """

    # Retrieve the reports from the sqlite db
    saved_reports = ProfilerSavedReports.query.all()

    # Format the reports to send to the client
    reports = []
    for report in saved_reports:
        reports.append({'name'         : report.name,
                        'database'     : report.dbname,
                        'time'         : report.time,
                        'profile_type' : report.direct,
                        'duration'     : report.duration,
                        'report_id'    : report.rid})

    return make_json_response(
        data={
            'status': 'Success',
            'result': reports
        }
    )

@blueprint.route(
    '/get_duration/<int:trans_id>', methods=['GET'],
    endpoint='get_duration'
)
def get_duration(trans_id):
    pfl_inst = ProfilerInstance(trans_id)
    if pfl_inst.profiler_data is None:
        return make_json_response(
            data={
                'status': 'NotConnected',
                'result': gettext(
                    'Not connected to server or connection with the server '
                    'has been closed'
                )
            })

    if pfl_inst.profiler_data['duration'] is None:
        return make_json_response(
            data={
                'status': 'Error',
                'result': gettext(
                    'Duration not found, was this an indirect profiling instance?'
                )
            }
        )

    return make_json_response(
        data={
            'status': 'Success',
            'duration' : pfl_inst.profiler_data['duration']
        }
    )


@blueprint.route(
    '/get_config/<int:trans_id>', methods=['GET'],
    endpoint='get_config'
)
@login_required
def get_config(trans_id):
    pfl_inst = ProfilerInstance(trans_id)
    if pfl_inst.profiler_data is None:
        return make_json_response(
            data={
                'status': 'NotConnected',
                'result': gettext(
                    'Not connected to server or connection with the server '
                    'has been closed'
                )
            })

    if pfl_inst.config is None:
        return make_json_response(
            data={
                'status': 'Error',
                'result': gettext(
                    'Config not found'
                )
            }
        )

    # Formatting the config for column view for client
    result = []
    for option in pfl_inst.config:
        result.append({
            'option': option,
            'value' : pfl_inst.config[option]
        })

    return make_json_response(
        data={
            'status': 'Success',
            'result': result
        }
    )

@blueprint.route(
    '/set_config/<int:trans_id>', methods=['POST'],
    endpoint='set_config'
)
@login_required
def set_config(trans_id):
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

    data = json.loads(request.values['data'], encoding='utf-8')
    try:
        pfl_inst.config = {
                   'name'       : data[0]['value'],
                   'title'      : data[1]['value'],
                   'tabstop'    : data[2]['value'],
                   'svg_width'  : data[3]['value'],
                   'table_width': data[4]['value'],
                   'desc'       : data[5]['value']
                  }

        return make_json_response(
            data={
                'status': 'Success',
            }
        )

    except Exception as e:
        current_app.logger.exception(e)
        return make_json_response(
            data={
                'status': 'ERROR',
                'result': str(e)
            }
        )
