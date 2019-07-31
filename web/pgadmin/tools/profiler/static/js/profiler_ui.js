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

          }
        }
      })

    }
  }

  Alertify.profilerInputArgsDialog(
      gettext('Profiler'), profile_info, restart_profile, is_edb_proc, trans_id
    ).resizeTo(pgBrowser.stdW.md,pgBrowser.stdH.md);
  };

});
