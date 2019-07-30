define([
  'sources/gettext', 'sources/url_for', 'jquery', 'underscore',
  'underscore.string', 'alertify', 'sources/pgadmin', 'pgadmin.browser',
  'backbone', 'pgadmin.backgrid', 'codemirror', 'pgadmin.backform',
  'wcdocker', 'pgadmin.browser.frame',
]), function(
  gettext, url_for, $, _, S, Alertify, pgAdmin, pgBrowser, Backbone, Backgrid,
  CodeMirror, Backform,
) {
  var pgTools = pgAdmin.Tools = pgAdmin.Tools || {},
    wcDocker = window.wcDocker;

    /* Return back, this has been called more than once */
    if (pgAdmin.Tools.Profiler)
      return pgAdmin.Tools.Profiler;

    pgTools.Profiler = {
      init: function() {
        // We do not want ot initialize the module multiple times.
        if (this.initialized)
          return;

        this.initalized = true;

        pgBrowser.add_menus([{
          name: 'direct_profiler',
          node: 'function',
          module: this,
          applies: ['object, context'],
          callback: 'get_function_information',
          category: gettext('Profiling'),
          priority: 10,
          label:gettext('Profile'),
          data: {
            object: 'function',
          },
          icon: 'fa fa-arrow-circle-right',
          enable: 'can-debug',
          },

          //TODO: more menus
        }]);

        // Create and load the new frame required for debugger panel
        this.frame = new pgBrowser.Frame({
          name: 'frm_Profiler',
          title: gettext('Profiler'),
          width: 500,
          isCloseable: true,
          isPrivate: true,
          icon: 'fa fa-bug',
          url: 'about:blank',
        });

        this.frame.load(pgBrowser.docker);

        // TODO: set caching preferences at an interval

      },

    // generates the endpoint url that will correspond to the correct method for the server to perform
    generate_url: function(_url, treeInfo, node) {
      var url = '{BASEURL}{URL}/{OBJTYPE}{REF}',
        ref = '';

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

      var args = {
        'URL': _url,
        'BASEURL': url_for('profiler.index'),
        'REF': ref,
        'OBJTYPE': encodeURI(node.type),
      };

      return url.replace(/{(\w+)}/g, function(match, arg) {
        return args[arg];
      });
    },

    /*
      Get the function information for the direct profiling to display the functions arguments and  other informations
      in the user input dialog
    */
    get_function_information: function(args, item) {
      var t = pgBrowser.tree,
        i = item || t.selected(),
        d = i && i.length == 1 ? t.itemData(i) : undefined,
        node = d && pgBrowser.Nodes[d._type],
        self = this,
        // is_edb_proc = d._type == 'edbproc';

        if (!d)
          return;

        //var treeInfo = node.getTreeNodeHierarchy.apply(node, [i]),
        //  _url = this.generate_url('init', treeInfo, node);

        $.ajax({
          url:_url,
          cache: false,
        })
          .done(function(res) {

          })

    },
  };

  return pgAdmin.Tools.Profiler;
});
