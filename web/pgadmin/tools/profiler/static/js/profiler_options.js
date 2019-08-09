/////////////////////////////////////////////////////////////
//
//
// TODO: support for restart_profile
//
//
//
/////////////////////////////////////////////////////////////

define([
  'sources/gettext', 'sources/url_for', 'jquery', 'underscore', 'backbone',
  'pgadmin.alertifyjs', 'sources/pgadmin', 'pgadmin.browser',
  'pgadmin.backgrid', 'wcdocker',
], function(
  gettext, url_for, $, _, Backbone, Alertify, pgAdmin, pgBrowser, Backgrid
) {

  var wcDocker = window.wcDocker;

  var ProfilerInputOptionsModel = Backbone.Model.extend({
    defaults: {
      option: undefined,
      value: undefined,
    },
    validate: function() {
      if (_.isUndefined(this.get('value')) ||
        _.isNull(this.get('value')) ||
        String(this.get('value')).replace(/^\s+|\s+$/g, '') == '') {
        var msg = gettext('Please enter a value for the parameter.');
        this.errorModel.set('value', msg);
        return msg;
      } else {
        this.errorModel.unset('value');
      }
      return null;
    },
  });

  // Collection which contains the model for function informations.
  var ProfilerInputOptionsCollections = Backbone.Collection.extend({
    model: ProfilerInputOptionsModel,
  });

  var res = function(profile_info, restart_profile, trans_id) {
    if (!Alertify.profilerInputOptionsDialog) {
      Alertify.dialog('profilerInputOptionsDialog', function factory() {
        return {
          main: function(title, db_info, restart_profile, trans_id) {
            this.preferences = window.top.pgAdmin.Browser.get_preferences_for_module('profiler');
            this.set('title', title);

            // setting value in alertify settings allows us to access it from
            // other functions other than main function.
            this.set('db_info', db_info);
            this.set('restart_profile', restart_profile);
            this.set('trans_id', trans_id);

            var my_obj = [];
            my_obj.push({
              'option' : 'Duration',
              'value'  : '',
            }, {
              'option' : 'Interval',
              'value'  : '',
            },
            {
              'option' : 'PID',
              'value'  : '',
            },);

            var option_header = Backgrid.HeaderCell.extend({
              // Add fixed width to the "option" column
              className: 'width_percent_25',
            });


            var gridCols = [{
              name: 'option',
              label: gettext('Option'),
              type: 'text',
              editable: false,
              cell: 'string',
              headerCell: option_header,
            },
            {
              name: 'value',
              label: gettext('Value'),
              type: 'text',
              cell: 'string',
            },
            ];

            this.ProfilerInputOptionsColl =
                new ProfilerInputOptionsCollections(my_obj);

            // Initialize a new Grid instance
            if (this.grid) {
              this.grid.remove();
              this.grid = null;
            }
            var grid = this.grid = new Backgrid.Grid({
              columns: gridCols,
              collection: this.ProfilerInputOptionsColl,
              className: 'backgrid table table-bordered table-noouter-border table-bottom-border',
            });

            grid.render();
            $(this.elements.content).html(grid.el);

            // For keyboard navigation in the grid
            // we'll set focus on checkbox from the first row if any
            var grid_checkbox = $(grid.el).find('input:checkbox').first();
            if (grid_checkbox.length) {
              setTimeout(function() {
                grid_checkbox.trigger('click');
              }, 250);
            }

          },
          settings: {
            profile_info: undefined,
            restart_profile: undefined,
            trans_id: undefined,
          },
          setup: function() {
            return {
              buttons: [{
                text: gettext('Cancel'),
                key: 27,
                className: 'btn btn-secondary fa fa-times pg-alertify-button',
              },{
                text: gettext('Profile'),
                key: 13,
                className: 'btn btn-primary fa fa-bullseye pg-alertify-button', // TODO: replace icon
              }],
              // Set options for dialog
              options: {
                //disable both padding and overflow control.
                padding: !1,
                overflow: !1,
                model: 0,
                resizable: true,
                maximizable: true,
                pinnable: false,
                closableByDimmer: false,
                modal: false,
              },
            };
          },
          // Callback functions when click on the buttons of the Alertify dialogs
          callback: function(e) {
            if (e.button.text === gettext('Profile')) {
              // Initialize the target once the debug button is clicked and
              // create asynchronous connection and unique transaction ID
              var self = this;

              // If the profiling is started again then treeInfo is already
              // stored in this.data so we can use the same.
              if (self.setting('restart_profile') == 0) {
                var t = pgBrowser.tree,
                  i = t.selected(),
                  d = i && i.length == 1 ? t.itemData(i) : undefined,
                  node = d && pgBrowser.Nodes[d._type];

                if (!d)
                  return;

                var treeInfo = node.getTreeNodeHierarchy.apply(node, [i]);
              }

              var options_value_list = [];
              // TODO
              // var sqlite_options_list = this.sqlite_options_list = [];

              this.grid.collection.each(function(m) {
                options_value_list.push({
                  'option': m.get('option'),
                  'value': m.get('value'),
                });
              });

              var baseUrl = url_for('profiler.initialize_target_indirect', {
                'profile_type' : 'indirect',
                'trans_id' : self.setting('trans_id'),
                'sid' : treeInfo.server._id,
                'did' : treeInfo.database._id,
              });

              $.ajax({
                url: baseUrl,
                method: 'POST',
                data: {
                  'data': JSON.stringify(options_value_list),
                },
              })
                .done(function(res) {
                  var url = url_for(
                    'profiler.profile', {
                      'trans_id' : res.data.profilerTransId,
                    }
                  );

                  if (self.preferences.profiler_new_browser_tab) {
                    window.open(url, '_blank');
                  } else {
                    pgBrowser.Events.once(
                      'pgadmin-browser:fram:urlload:frm_profiler',
                      function(frame) {
                        frame.openURL(url);
                      });

                    var dashboardPanel = pgBrowser.docker.findPanels('properties'),
                      panel = pgBrowser.docker.addPanel(
                        'frm_profiler', wcDocker.DOCK.STACKED, dashboardPanel[0]
                      );

                    panel.focus();

                    // Panel Closed event
                    panel.on(wcDocker.EVENT.CLOSED, function() {
                      var closeUrl = url_for('profiler.close', {
                        'trans_id': res.data.profilerTransId,
                      });
                      $.ajax({
                        url: closeUrl,
                        method: 'DELETE',
                      });
                    });
                  }

                })
                .fail(function(e) {
                  Alertify.alert(
                    gettext('Profiler Initialization Error'),
                    e.responseJSON.errormsg
                  );
                });

              return true;
            }


            if (e.button.text === gettext('Cancel')) {
              /* Clear the trans id */
              $.ajax({
                method: 'DELETE',
                url: url_for('profiler.close', {'trans_id': this.setting('trans_id')}),
              });

              return false;
            }
          },
          build: function() {
            Alertify.pgDialogBuild.apply(this);
          },
          prepare: function() {
            // Add our class to alertify
            $(this.elements.body.childNodes[0]).addClass(
              'alertify_tools_dialog_properties obj_properties'
            );

            /*
             Listen to the grid change event so that if any value changed by user then we can enable/disable the
             profile button.
            */
            this.grid.listenTo(this.profilerInputOptionsColl, 'backgrid:edited',
              (function(obj) {

                return function() {

                  var enable_btn = false;

                  for (var i = 0; i < this.collection.length; i++) {

                    if (this.collection.models[i].get('is_null')) {
                      obj.__internal.buttons[1].element.disabled = false;
                      enable_btn = true;
                      continue;
                    }
                  }
                  if (!enable_btn)
                    obj.__internal.buttons[1].element.disabled = false;
                };
              })(this)
            );

            this.grid.listenTo(this.profilerInputOptionsColl, 'backgrid:error',
              (function(obj) {
                return function() {
                  obj.__internal.buttons[1].element.disabled = true;
                };
              })(this)
            );
          },
        };
      });
    }

    Alertify.profilerInputOptionsDialog(
      gettext('Monitoring Options'), profile_info, restart_profile, trans_id
    ).resizeTo(pgBrowser.stdW.md,pgBrowser.stdH.md);
  };

  return res;
});
