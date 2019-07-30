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

# import statements go here

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
        return []

    def on_logout(self, user):
        """
        This is a callback function when user logout from pgAdmin
        :param user:
        :return:
        """
        close_profiler_session(None, close_all=True)

####################################################################################################

blueprint = DebuggerModule(MODULE_NAME, __name__)

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

@blueprint.route("/js/debugger_ui.js")
@login_required
def script_debugger_js():
    """render the debugger UI javascript file"""
    return Response(
        response=render_template("debugger/js/debugger_ui.js", _=gettext),
        status=200,
        mimetype="application/javascript"
    )


@blueprint.route("/js/direct.js")
@login_required
def script_debugger_direct_js():
    """
    Render the javascript file required send and receive the response
    from server for debugging
    """
    return Response(
        response=render_template("debugger/js/direct.js", _=gettext),
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
    This is only required for direct profiling. As Indirect debugging does
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
