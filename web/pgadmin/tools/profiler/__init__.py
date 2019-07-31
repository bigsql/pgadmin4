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

# Flask imports
from flask import url_for, Response, render_template, request, session, \
    current_app
from flask_babelex import gettext
from flask_security import login_required

# pgAdmin utils imports
from pgadmin.utils import PgAdminModule
from pgadmin.utils.ajax import bad_request
from pgadmin.utils.ajax import make_json_response, \
    internal_server_error
from pgadmin.utils.driver import get_driver

# other imports
from config import PG_DEFAULT_DRIVER
from pgadmin.tools.profiler.utils.profiler_instance import ProfilerInstance


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

    def get_exposed_url_endpoints(self):
        return ['profiler.index', 'profiler.init_for_function']

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
