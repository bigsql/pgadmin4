/////////////////////////////////////////////////////////////
//
//
//
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

  /**
   *  ProfilerInputArgsModel used to represent input parameters for the function to profile
   *  for function objects.
   **/
  var DebuggerInputArgsModel = Backbone.Model.extend({
    defaults: {
      name: undefined,
      type: undefined,
      is_null: undefined,
      expr: undefined,
      value: undefined,
      use_default: undefined,
      default_value: undefined,
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
  var ProfilerInputArgCollections = Backbone.Collection.extend({
    model: ProfilerInputArgsModel,
  });


  var res = function(profile_info, restart_profile, is_edb_proc, trans_id) {
    if (!Alertify.profilerInputArgsDialog) {
      Alertify.dialog('profilerInputArgsDialog', function factory() {
        return {
          main: function(title, profile_info, restart_profile, is_edb_proc, trans_id) {
            this.preferences = window.top.pgAdmin.Browser.get_preferences_for_module('profiler');
            this.set('title', title);

            // setting value in alertify settings allows us to access it from
            // other functions other than main function.
            this.set('profile_info', profile_info);
            this.set('restart_profile', restart_profile);
            this.set('trans_id', trans_id);

            // Variables to store the data sent from sqlite database
            // var func_args_data = this.func_args_data = [];

            // As we are not getting pgBrowser.tree when we profile again
            // so tree info will be updated from the server data
            if (restart_profile == 0) {
              var t = pgBrowser.tree,
                i = t.selected(),
                d = i && i.length == 1 ? t.itemData(i) : undefined,
                node = d && pgBrowser.Nodes[d._type];

              if (!d)
                return;

              var treeInfo = node.getTreeNodeHierarchy.apply(node, [i]);
            }

            $.ajax({
              url: _Url,
              method: 'GET',
              async: false,
            })
              .done(function(res) {
                // store the function params into sqlite database
              })
              .fail(function() {
                Alertify.alert(
                  gettext('Profiler Error'),
                  gettext('unable to fetch the arguments from the server')
                );
              });

            var argname, argtype, argmode, default_args_count, default_args, arg_cnt;

            var value_header = Backgrid.HeaderCell.extend({
              // Add fixed width to the "value" column
              className: 'width_percent_25',
            });

            var def_val_list = [],
              gridCols = [{
                name: 'name',
                label: gettext('Name'),
                type: 'text',
                editable: false,
                cell: 'string',
              },
              {
                name: 'type',
                label: gettext('Type'),
                type: 'text',
                editable: false,
                cell: 'string',
              },
              {
                name: 'is_null',
                label: gettext('Null?'),
                type: 'boolean',
                cell: 'boolean',
              },
              {
                name: 'expr',
                label: gettext('Expression?'),
                type: 'boolean',
                cellFunction: cellExprControlFunction,
                editable: disableExpressionControl,
              },
              {
                name: 'value',
                label: gettext('Value'),
                type: 'text',
                editable: true,
                cellFunction: cellFunction,
                headerCell: value_header,
              },
              {
                name: 'use_default',
                label: gettext('Use Default?'),
                type: 'boolean',
                cell: 'boolean',
                editable: disableDefaultCell,
              },
              {
                name: 'default_value',
                label: gettext('Default'),
                type: 'text',
                editable: false,
                cell: 'string',
              },
              ];

            var my_obj = [];
            var func_obj = [];

            argtype = profile_info['proargtypenames'].split(',');

            // ??
            if (profile_info['proargmodes'] != null) {
              argmode = profile_info['proargmodes'].split(',');
            }

            // if there is more than 1 default arg value
            if (profile_info['pronargdefaults']) {
              default_args_count = profile_info['pronargdefaults'];
              default_args = profile_info['proargdefaults'].split(',');
              arg_cnt = default_args_count;
            }

            var vals, values, index, use_def_value, j;

            // if the procedure has arguments
            if (profile_info['proargnames'] != null) {
              argname = profile_info['proargnames'].split(',');

              // It will assign default values to "Default value" column
              for (j = (argname.length - 1); j >= 0; j--) {
                if (profile_info['proargmodes'] != null) {
                  if (argmode[j] == 'i' || argmode[j] == 'b' ||
                    (is_edb_proc && argmode[j] == 'o')) {
                    if (arg_cnt) {
                      arg_cnt = arg_cnt - 1;
                      def_val_list[j] = default_args[arg_cnt];
                    } else {
                      def_val_list[j] = '<no default>';
                    }
                  }
                } else if (arg_cnt) {
                  arg_cnt = arg_cnt - 1;
                  def_val_list[j] = default_args[arg_cnt];
                } else {
                  def_val_list[j] = '<no default>';
                }
              }

              // If there is more than 1 arg
              // (comparing the length of the array containing the types of the arguments)
              if (argtype.length != 0) {

                // for every arg
                for (i = 0; i < argtype.length; i++) {

                  // ??
                  if (profile_info['proargmodes'] != null) {

                    // ??
                    if (argmode[i] == 'i' || argmode[i] == 'b' ||
                      (is_edb_proc && argmode[i] == 'o')) {
                      use_def_value = false;
                      if (def_val_list[i] != '<no default>') {
                        use_def_value = true;
                      }
                      my_obj.push({
                        'name': argname[i],
                        'type': argtype[i],
                        'use_default': use_def_value,
                        'default_value': def_val_list[i],
                      });
                    }
                  } else {
                    use_def_value = false;
                    if (def_val_list[i] != '<no default>') {
                      use_def_value = true;
                    }
                    my_obj.push({
                      'name': argname[i],
                      'type': argtype[i],
                      'use_default': use_def_value,
                      'default_value': def_val_list[i],
                    });
                  }
                }
              }
            } else {
              /*
               Generate the name parameter if function do not have arguments name
               like dbgparam1, dbgparam2 etc.
              */
              var myargname = [];

              for (i = 0; i < argtype.length; i++) {
                myargname[i] = 'pflparam' + (i + 1);
              }

              // If there is no default arguments
              if (!profile_info['pronargdefaults']) {
                for (i = 0; i < argtype.length; i++) {
                  my_obj.push({
                    'name': myargname[i],
                    'type': argtype[i],
                    'use_default': false,
                    'default_value': '<No default value>',
                  });
                  def_val_list[i] = '<No default value>';
                }
              } else {
                // If there is default arguments
                //Below logic will assign default values to "Default value" column
                for (j = (myargname.length - 1); j >= 0; j--) {
                  if (profile_info['proargmodes'] == null) {
                    if (arg_cnt) {
                      arg_cnt = arg_cnt - 1;
                      def_val_list[j] = default_args[arg_cnt];
                    } else {
                      def_val_list[j] = '<No default value>';
                    }
                  } else {
                    if (arg_cnt) {
                      arg_cnt = arg_cnt - 1;
                      def_val_list[j] = default_args[arg_cnt];
                    } else {
                      def_val_list[j] = '<No default value>';
                    }
                  }
                }

                for (i = 0; i < argtype.length; i++) {
                  if (profile_info['proargmodes'] == null) {
                    use_def_value = false;
                    if (def_val_list[i] != '<No default value>') {
                      use_def_value = true;
                    }
                    my_obj.push({
                      'name': myargname[i],
                      'type': argtype[i],
                      'use_default': use_def_value,
                      'default_value': def_val_list[i],
                    });
                  } else {
                    if (argmode[i] == 'i' || argmode[i] == 'b' ||
                      (is_edb_proc && argmode[i] == 'o')) {
                      use_def_value = false;
                      if (def_val_list[i] != '<No default value>') {
                        use_def_value = true;
                      }
                      my_obj.push({
                        'name': myargname[i],
                        'type': argtype[i],
                        'use_default': use_def_value,
                        'default_value': def_val_list[i],
                      });
                    }
                  }
                }
              }
            }

            // Check if the arguments already available in the sqlite database
            // then we should use the existing arguments
            //if (func_args_data.length == 0) {
              this.profilerInputArgsColl =
                new ProfilerInputArgCollections(my_obj);
            //} else {
            //  this.debuggerInputArgsColl =
            //    new DebuggerInputArgCollections(func_obj);
            //}

            // Initialize a new Grid instance
            if (this.grid) {
              this.grid.remove();
              this.grid = null;
            }
            var grid = this.grid = new Backgrid.Grid({
              columns: gridCols,
              collection: this.profilerInputArgsColl,
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
                className: 'btn btn-primary fa fa-bug pg-alertify-button',
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

          build: function() {
            Alertify.pgDialogBuild.apply(this);
          },
          prepare: function() {
            // Add our class to alertify
            $(this.elements.body.childNodes[0]).addClass(
              'alertify_tools_dialog_properties obj_properties'
            );

            /*
             If we already have data available in sqlite database then we should
             enable the profile button otherwise disable the profile button.
            */
            if (this.func_args_data.length == 0) {
              this.__internal.buttons[1].element.disabled = true;
            } else {
              this.__internal.buttons[1].element.disabled = false;
            }

            /*
             Listen to the grid change event so that if any value changed by user then we can enable/disable the
             profile button.
            */
            this.grid.listenTo(this.profileInputArgsColl, 'backgrid:edited',
              (function(obj) {

                return function() {

                  var enable_btn = false;

                  for (var i = 0; i < this.collection.length; i++) {

                    if (this.collection.models[i].get('is_null')) {
                      obj.__internal.buttons[1].element.disabled = false;
                      enable_btn = true;
                      continue;
                    }
                    // TODO: Need to check the "Expression" column value to
                    // enable/disable the "Profile" button
                    if (this.collection.models[i].get('value') == null ||
                        this.collection.models[i].get('value') == undefined) {
                      enable_btn = true;

                      if (this.collection.models[i].get('use_default')) {
                        obj.__internal.buttons[1].element.disabled = false;
                      } else {
                        obj.__internal.buttons[1].element.disabled = true;
                        break;
                      }
                    }
                  }
                  if (!enable_btn)
                    obj.__internal.buttons[1].element.disabled = false;
                };
              })(this)
            );

            this.grid.listenTo(this.profilerInputArgsColl, 'backgrid:error',
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

    Alertify.profilerInputArgsDialog(
        gettext('Profiler'), profile_info, restart_profile, is_edb_proc, trans_id
    ).resizeTo(pgBrowser.stdW.md,pgBrowser.stdH.md);
  };

  return res;
});
