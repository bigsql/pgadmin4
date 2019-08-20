/////////////////////////////////////////////////////////////
//
//
//
//
//
//
/////////////////////////////////////////////////////////////

define([
  'sources/gettext', 'sources/url_for', 'jquery', 'underscore',
  'underscore.string', 'alertify', 'sources/pgadmin', 'pgadmin.browser',
  'backbone', 'pgadmin.backgrid', 'codemirror', 'pgadmin.backform',
  'pgadmin.tools.profiler.ui', 'pgadmin.tools.profiler.options', 'pgadmin.tools.profiler.utils',
  'wcdocker', 'pgadmin.browser.frame',
], function(
  gettext, url_for, $, _, S, Alertify, pgAdmin, pgBrowser, Backbone, Backgrid,
  CodeMirror, Backform, get_function_arguments, get_option_arguments, profilerUtils
) {
  const pgTools = pgAdmin.Tools = pgAdmin.Tools || {},
    wcDocker = window.wcDocker;

  /* Return back, this has been called more than once */
  if (pgAdmin.Tools.Profiler)
    return pgAdmin.Tools.Profiler;

  pgTools.Profiler = {
    init: function() {

      // We do not want to initialize the module multiple times.
      if (this.initialized)
        return;

      this.initalized = true;

      pgBrowser.add_menus([{
        name: 'direct_profiler',
        node: 'function',
        module: this,
        applies: ['object', 'context'],
        callback: 'get_function_information',
        category: gettext('Profiling'),
        priority: 11,
        label:gettext('Direct Profiling'),
        data: {
          object: 'function',
        },
        icon: 'fa fa-arrow-circle-right',
        enable: 'can_profile',
      }, {
        name: 'procedure_direct_profiler',
        node: 'procedure',
        module: this,
        applies: ['object', 'context'],
        callback: 'get_function_information',
        category: gettext('Profiling'),
        priority: 10,
        label: gettext('Direct Profiling'),
        data: {
          object: 'procedure',
        },
        icon: 'fa fa-arrow-circle-right',
        enable: 'can_profile',
      }, {
        name: 'indirect_profiler',
        node: 'database',
        module: this,
        applies: ['object', 'context'],
        callback: 'get_options',
        category: gettext('Profiling'),
        priority: 11,
        label:gettext('Global Profiling'),
        data: {
          object: 'function',
        },
        icon: 'fa fa-arrow-circle-right',
        enable: true,
      },
      ]);

      // Create and load the new frame required for profiler panel
      this.frame = new pgBrowser.Frame({
        name: 'frm_profiler',
        title: gettext('Profiler'),
        width: 500,
        isCloseable: true,
        isPrivate: true,
        icon: 'fa fa-bullseye', // TODO: Create an icon
        url: 'about:blank',
      });

      this.frame.load(pgBrowser.docker);

      let self = this;
      let cacheIntervalId = setInterval(function() {
        if(pgBrowser.preference_version() > 0) {
          self.preferences = pgBrowser.get_preferences_for_module('profiler');
          clearInterval(cacheIntervalId);
        }
      },0);

      pgBrowser.onPreferencesChange('profiler', function() {
        self.preferences = pgBrowser.get_preferences_for_module('profiler');
      });

    },
    can_profile: function(itemData, item) {
      const t = pgBrowser.tree;
      let i = item,
        d = itemData;
      // To iterate over tree to check parent node
      while (i) {
        if ('catalog' == d._type) {
          //Check if we are not child of catalog
          return false;
        }
        i = t.hasParent(i) ? t.parent(i) : null;
        d = i ? t.itemData(i) : null;
      }

      // Find the function is really available in database
      const tree = pgBrowser.tree,
        info = tree.selected(),
        d_ = info && info.length == 1 ? tree.itemData(info) : undefined;

      if (!d_)
        return false;

      // For trigger node, language will be undefined
      if (d_.language == undefined && d_._type == 'trigger'){
        return true;
      }

      if (d_.language != 'plpgsql') {
        return false;
      }

      return true;
    },

    generate_url: function(_url, treeInfo, node) {
      let ref = '';

      _.each(
        _.sortBy(
          _.values(
            _.pick(treeInfo,
              function(v, k) {
                return (k != 'server_group');
              })
          ),
          function(o) {
            return o.priority;
          }
        ),
        function(o) {
          ref = S('%s/%s').sprintf(ref, encodeURI(o._id)).value();
        });

      const args = {
        'URL': _url,
        'BASEURL': url_for('profiler.index'),
        'REF': ref,
        'OBJTYPE': encodeURI(node.type),
      };

      const url = '{BASEURL}{URL}/{OBJTYPE}{REF}';
      return url.replace(/{(\w+)}/g, function(match, arg) {
        return args[arg];
      });
    },

    get_options: function(args, item) {
      const t = pgBrowser.tree,
        i = item || t.selected(),
        d = i && i.length == 1 ? t.itemData(i) : undefined,
        node = d && pgBrowser.Nodes[d._type];

      if (!d)
        return;

      // Generate the URL to create a profiler instance
      const treeInfo = node.getTreeNodeHierarchy.apply(node, [i]);

      $.ajax({
        url: this.generate_url('init', treeInfo, node),
        cache: false,
      })
        .done(function(res) {
          let trans_id = res.data.trans_id;
          get_option_arguments(res.data.db_info, 0, trans_id);
        });

    },

    /*
      Get the function information for the direct profiling to display the functions arguments and  other informations
      in the user input dialog
    */
    get_function_information: function(args, item) {
      const t = pgBrowser.tree,
        i = item || t.selected(),
        d = i && i.length == 1 ? t.itemData(i) : undefined,
        node = d && pgBrowser.Nodes[d._type],
        self = this;

      if (!d)
        return;

      // Generate the URL to create a profiler instance
      const treeInfo = node.getTreeNodeHierarchy.apply(node, [i]);
      $.ajax({
        url: this.generate_url('init', treeInfo, node),
        cache: false,
      })
        .done(function(res) {

          const profile_info = res.data.profile_info,
            trans_id = res.data.trans_id;
          // Open Alertify the dialog to take the input arguments from user if function having input arguments
          if (profile_info[0]['require_input']) {
            get_function_arguments(profile_info[0], 0, trans_id);
          } else {
            // Initialize the target and create asynchronous connection and unique transaction ID
            // If there is no arguments to the functions then we should not ask for for function arguments and
            // Directly open the panel
            const t = pgBrowser.tree,
              i = t.selected(),
              d = i && i.length == 1 ? t.itemData(i) : undefined,
              node = d && pgBrowser.Nodes[d._type];

            if (!d) {
              return;
            }

            const treeInfo = node.getTreeNodeHierarchy.apply(node, [i]);
            let initTargetUrl = '';

            if (d._type == 'function') {
              initTargetUrl = url_for(
                'profiler.initialize_target_for_function', {
                  'trans_id': trans_id,
                  'sid': treeInfo.server._id,
                  'did': treeInfo.database._id,
                  'scid': treeInfo.schema._id,
                  'func_id': profilerUtils.getFunctionId(treeInfo),
                }
              );
            } else if(d._type == 'procedure') {
              initTargetUrl = url_for(
                'profiler.initialize_target_for_function', {
                  'trans_id': trans_id,
                  'sid': treeInfo.server._id,
                  'did': treeInfo.database._id,
                  'scid': treeInfo.schema._id,
                  'func_id': profilerUtils.getProcedureId(treeInfo),
                }
              );
            }

            $.ajax({
              url: initTargetUrl,
              method: 'GET',
            })
              .done(function() {
                const url = url_for('profiler.profile', { 'trans_id': trans_id });

                if (self.preferences.profiler_new_browser_tab) {
                  window.open(url, '_blank');
                } else {
                  pgBrowser.Events.once(
                    'pgadmin-browser:frame:urlloaded:frm_profiler',
                    (frame) => frame.openURL(url)
                  );

                  // Create the profiler panel as per the data received from user input dialog.
                  const dashboardPanel = pgBrowser.docker.findPanels(
                      'properties'
                    ),
                    panel = pgBrowser.docker.addPanel(
                      'frm_profiler', wcDocker.DOCK.STACKED, dashboardPanel[0]
                    );

                  panel.focus();

                  // Register Panel Closed event
                  panel.on(wcDocker.EVENT.CLOSED, function() {
                    $.ajax({
                      url: url_for('profiler.close', { 'trans_id': trans_id }),
                      method: 'DELETE',
                    });
                  });
                }
              })
              .fail(function(e) {
                Alertify.alert(
                  gettext('Profiler Target Initialization Error'),
                  e.responseJSON.errormsg
                );
              });
          }
        })
        .fail(function(xhr) {
          try {
            const err = JSON.parse(xhr.responseText);
            if (err.success == 0) {
              Alertify.alert(gettext('Debugger Error'), err.errormsg);
            }
          } catch (e) {
            console.warn(e.stack || e);
          }
        });
    },
  };

  return pgAdmin.Tools.Profiler;
});
