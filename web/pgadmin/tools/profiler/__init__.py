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
from pgadmin.tools.profiler.utils.profiler_instance import ProfilerInstance

# plprofiler import
import plprofiler

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
                'profiler.start_listener',# 'profiler.execute_query',
                'profiler.messages',
                'profiler.start_execution',# 'profiler.set_breakpoint',
                #'profiler.clear_all_breakpoint', 'profiler.deposit_value',
                #'profiler.select_frame', 'profiler.get_arguments',
                #'profiler.set_arguments',
                #'profiler.poll_end_execution_result', 'profiler.poll_result'
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

    # Check server type is ppas or not
    ppas_server = False
    is_proc_supported = False
    if server_type == 'ppas':
        ppas_server = True
    else:
        is_proc_supported = True if manager.version >= 110000 else False

    # Set the template path required to read the sql files
    template_path = 'profiler/sql'

    sql = ''
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
    if profile_type == 'indirect':
        # TODO: global profiling error checking
        raise Exception('Indirect(global) profiling not currently support')

    # TODO: PPAS/EPAS 11 & above support

    # Set the template path required to read the sql files
    template_path = 'profiler/sql'

    # TODO: trigger func support
    # TODO: Version check

    pfl_inst = ProfilerInstance(trans_id)
    if request.method == 'POST':
        data = json.loads(request.values['data'], encoding='utf-8')
        if data:
            pfl_inst.function_data['args_value'] = data

    # Update the profiler data session variable
    # Here frame_id is required when user profiler the multilevel function.
    # When user select the frame from client we need to update the frame
    # here and set the breakpoint information on that function oid
    pfl_inst.profiler_data = {
        'conn_id': conn_id,
        'server_id': sid,
        'database_id': did,
        'schema_id': scid,
        'function_id': func_id,
        'function_name': pfl_inst.function_data['name'],
        'profile_type': profile_type,
        'profiler_version': 1.0, # Placeholder
        'frame_id': 0,
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
    '/messages/<int:trans_id>/', methods=["GET"], endpoint='messages'
)
@login_required
def messages(trans_id):
    """
    messages(trans_id)

    This method polls the messages returned by the database server.

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

    manager = get_driver(PG_DEFAULT_DRIVER).connection_manager(
        pfl_inst.profiler_data['server_id'])
    conn = manager.connection(
        did=pfl_inst.profiler_data['database_id'],
        conn_id=pfl_inst.profiler_data['conn_id'])

    port_number = ''

    if conn.connected():
        status, result = conn.poll()
        notify = conn.messages()
        # Not sure what to do here

        return make_json_response(
            data={'status': 'Success', 'result': 'connected'}
        )
    else:
        result = gettext(
            'Not connected to server or connection with the '
            'server has been closed.'
        )
        return internal_server_error(errormsg=str(result))


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
    #if dbg_version <= 2:
    #    template_path = 'debugger/sql/v1'
    #else:
    #    template_path = 'debugger/sql/v2'

    # Render the sql by hand here
    func_name = pfl_inst.function_data['name']
    func_args = pfl_inst.function_data['args_value']

    sql = 'SELECT * FROM ' + func_name + '('
    for arg_idx in range(len(func_args)):
        sql += str(func_args[arg_idx]['type']) + ' '
        sql += '\'' + str(func_args[arg_idx]['value']) + '\''
        if (arg_idx < len(func_args) - 1):
            sql += ', '

    sql += ');'

    conn.execute_async('SET search_path to ' + pfl_inst.function_data['schema'] + ';')
    conn.execute_async('SELECT pl_profiler_set_enabled_local(true)')
    conn.execute_async('SELECT pl_profiler_set_collect_interval(0)')
    status, result = conn.execute_async(sql)
    conn.execute_async('SELECT pl_profiler_set_enabled_local(false)')
    conn.execute_async('RESET search_path')

    html = ''

    return make_json_response(
        data={
            'status': 'Success',
            'result': str(result),
            'html'  : html
        }
    )

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

    arg_values = pfl_inst.function_data['args_value']

    return make_json_response(
        data={
            'status': 'Success',
            'result': arg_values
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
