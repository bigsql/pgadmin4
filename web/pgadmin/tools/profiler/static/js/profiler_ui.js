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
  gettext, url_for, $, _, Backbone, Alertify, pgAdmin, pgBrowser, Backgrid,
) {

  const wcDocker = window.wcDocker;

  /*
   * Function used to return the respective Backgrid control based on the data type
   * of function input argument.
   */
  const cellFunction = function(model) {
    const variable_type = model.get('type');

    // if variable type is an array then we need to render the custom control to take the input from user.
    if (variable_type.indexOf('[]') != -1) {
      const data_type = variable_type.replace('[]' ,'');

      switch (data_type) {
      case 'boolean':
        return Backgrid.Extension.InputBooleanArrayCell;
      case 'integer':
      case 'smallint':
      case 'bigint':
      case 'serial':
      case 'smallserial':
      case 'bigserial':
      case 'oid':
      case 'cid':
      case 'xid':
      case 'tid':
        return Backgrid.Extension.InputIntegerArrayCell;
      case 'real':
      case 'numeric':
      case 'double precision':
      case 'decimal':
        return Backgrid.Extension.InputNumberArrayCell;
      default:
        return Backgrid.Extension.InputStringArrayCell;
      }
    } else {
      switch (variable_type) {
      case 'boolean':
        return Backgrid.BooleanCell.extend({
          formatter: Backgrid.BooleanCellFormatter,
        });
      case 'integer':
      case 'smallint':
      case 'bigint':
      case 'serial':
      case 'smallserial':
      case 'bigserial':
      case 'oid':
      case 'cid':
      case 'xid':
      case 'tid':
        // As we are getting this value as text from sqlite database so we need to type cast it.
        if (model.get('value') != undefined) {
          model.set({
            'value': parseInt(model.get('value')),
          }, {
            silent: true,
          });
        }

        return Backgrid.IntegerCell;
      case 'real':
      case 'numeric':
      case 'double precision':
      case 'decimal':
        // As we are getting this value as text from sqlite database so we need to type cast it.
        if (model.get('value') != undefined) {
          model.set({
            'value': parseFloat(model.get('value')),
          }, {
            silent: true,
          });
        }
        return Backgrid.NumberCell;
      case 'string':
        return Backgrid.StringCell;
      case 'date':
        return Backgrid.DateCell;
      default:
        return Backgrid.Cell;
      }
    }
  };

  /*
   * Function used to return the respective Backgrid string or boolean control based on the data type
   * of function input argument.
   */
  const cellExprControlFunction = function(model) {
    const variable_type = model.get('type');
    if (variable_type.indexOf('[]') != -1) {
      return Backgrid.StringCell;
    }
    return Backgrid.BooleanCell;
  };

  /**
   *  ProfilerInputArgsModel used to represent input parameters for the function to profile
   *  for function objects.
   **/
  const ProfilerInputArgsModel = Backbone.Model.extend({
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
        const msg = gettext('Please enter a value for the parameter.');
        this.errorModel.set('value', msg);
        return msg;
      } else {
        this.errorModel.unset('value');
      }

      return null;
    },
  });

  // Collection which contains the model for function informations.
  const ProfilerInputArgCollections = Backbone.Collection.extend({
    model: ProfilerInputArgsModel,
  });

  // function will enable/disable the use_default column based on the value received.
  const disableDefaultCell = function(d) {
    if (d instanceof Backbone.Model) {
      return d.get('use_default');
    }
    return false;
  };

  // Enable/Disable the control based on the array data type of the function input arguments
  const disableExpressionControl = function(d) {
    if (d instanceof Backbone.Model) {
      const argType = d.get('type');
      if (argType.indexOf('[]') != -1) {
        return false;
      }
      return true;
    }
  };


  const res = function(profile_info, restart_profile, trans_id) {
    if (!Alertify.profilerInputArgsDialog) {
      Alertify.dialog('profilerInputArgsDialog', function factory() {
        return {

          /**
           * Sets up the Alertify dialog box by creating grid and input areas
           *
           * @param {String} title title of the window
           * @param {Object} profile_info information of the profile(e.g. server_id, db_id)
           * @param {number} trans_id the unique transaction Id that was generated
           */
          main: function(title, profile_info, restart_profile, trans_id) {
            this.preferences = window.top.pgAdmin.Browser.get_preferences_for_module('profiler');
            this.set('title', title);

            // setting value in alertify settings allows us to access it from
            // other functions other than main function.
            this.set('profile_info', profile_info);
            this.set('restart_profile', restart_profile);
            this.set('trans_id', trans_id);

            // Variables to store the data sent from sqlite database
            const func_args_data = this.func_args_data = [];

            // As we are not getting pgBrowser.tree when we profile again
            // so tree info will be updated from the server data
            let i = void 0;
            let _Url = void 0;
            let d = void 0;

            if (restart_profile == 0) {
              const t = pgBrowser.tree;

              i = t.selected();
              d = i && i.length == 1 ? t.itemData(i) : undefined;

              let node = d && pgBrowser.Nodes[d._type];

              if (!d)
                return;

              const treeInfo = node.getTreeNodeHierarchy.apply(node, [i]);

              if (d._type == 'function') {
                _Url = url_for('profiler.get_arguments', {
                  'sid': treeInfo.server._id,
                  'did': treeInfo.database._id,
                  'scid': treeInfo.schema._id,
                  'func_id': treeInfo.function._id,
                });
              } else if (d._type == 'procedure') {
                // Get the existing function parameters available from sqlite database
                _Url = url_for('profiler.get_arguments', {
                  'sid': treeInfo.server._id,
                  'did': treeInfo.database._id,
                  'scid': treeInfo.schema._id,
                  'func_id': treeInfo.procedure._id,
                });
              }
            } else {
              _Url = url_for('profiler.get_arguments', {
                'sid': profile_info.server_id,
                'did': profile_info.database_id,
                'scid': profile_info.schema_id,
                'func_id': profile_info.function_id,
              });
            }

            $.ajax({
              url: _Url,
              method: 'GET',
              async: false,
            })
              .done(function(res) {
                // The given func/proc accepts args
                if (res.data.args_count != 0) {
                  for (i = 0; i < res.data.result.length; i++) {
                  // Below will format the data to be stored in sqlite database
                    func_args_data.push({
                      'arg_id': res.data.result[i]['arg_id'],
                      'is_null': res.data.result[i]['is_null'],
                      'is_expression': res.data.result[i]['is_expression'],
                      'use_default': res.data.result[i]['use_default'],
                      'value': res.data.result[i]['value'],
                    });
                  }
                }
              })
              .fail(function() {
                Alertify.alert(
                  gettext('Profiler Error'),
                  gettext('unable to fetch the arguments from the server')
                );
              });

            let argmode = void 0;
            let default_args = void 0;
            let arg_cnt = void 0;

            const def_val_list = [],
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
                headerCell: Backgrid.HeaderCell.extend({
                  // Add fixed width to the "value" column
                  className: 'width_percent_25',
                }),
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

            const my_obj = [];
            const func_obj = []; // For getting/setting params from sqlite db

            // Below will calculate the input argument id required to store in sqlite database
            const input_arg_id = this.input_arg_id = [];

            if (profile_info['proargmodes'] != null) {
              const argmode_1 = profile_info['proargmodes'].split(',');
              for (let k = 0; k < argmode_1.length; k++) {
                if (argmode_1[k] == 'i' || argmode_1[k] == 'b') {
                  input_arg_id.push(k);
                }
              }
            } else {
              const argtype_1 = profile_info['proargtypenames'].split(',');
              for (let k = 0; k < argtype_1.length; k++) {
                input_arg_id.push(k);
              }
            }

            let argtype = profile_info['proargtypenames'].split(',');

            if (profile_info['proargmodes'] != null) {
              argmode = profile_info['proargmodes'].split(',');
            }

            if (profile_info['pronargdefaults']) {
              let default_args_count = profile_info['pronargdefaults'];
              default_args = profile_info['proargdefaults'].split(',');
              arg_cnt = default_args_count;
            }

            let use_def_value = void 0;

            if (profile_info['proargnames'] != null) {
              let argname = profile_info['proargnames'].split(',');

              // It will assign default values to "Default value" column
              for (let j = (argname.length - 1); j >= 0; j--) {
                if (profile_info['proargmodes'] != null) {
                  if (argmode[j] == 'i' || argmode[j] == 'b') {
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

              if (argtype.length != 0) {
                for (let i = 0; i < argtype.length; i++) {
                  if (profile_info['proargmodes'] != null) {
                    if (argmode[i] == 'i' || argmode[i] == 'b') {
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

              // Need to update the func_obj variable from sqlite database if available
              if (func_args_data.length != 0) {
                for (let i = 0; i < func_args_data.length; i++) {
                  if (profile_info['proargmodes'] != null) {
                    continue;
                  }

                  let index = func_args_data[i]['arg_id'];
                  let values = [];
                  if (argtype[index].indexOf('[]') != -1) {
                    let vals = func_args_data[i]['value'].split(',');
                    _.each(vals, function(val) {
                      values.push({
                        'value': val,
                      });
                    });
                  } else {
                    values = func_args_data[i]['value'];
                  }

                  func_obj.push({
                    'name': argname[index],
                    'type': argtype[index],
                    'is_null': func_args_data[i]['is_null'] ? true : false,
                    'expr': func_args_data[i]['is_expression'] ? true : false,
                    'value': values,
                    'use_default': func_args_data[i]['use_default'] ? true : false,
                    'default_value': def_val_list[index],
                  });
                }
              }
            } else {
              /*
               Generate the name parameter if function do not have arguments name
               like pflparam1, pflparam2 etc.
              */
              const myargname = [];

              for (let i = 0; i < argtype.length; i++) {
                myargname[i] = 'pflparam' + (i + 1);
              }

              // If there is no default arguments
              if (!profile_info['pronargdefaults']) {
                for (let i = 0; i < argtype.length; i++) {
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
                for (let j = (myargname.length - 1); j >= 0; j--) {
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

                for (let i = 0; i < argtype.length; i++) {
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
                    if (argmode[i] == 'i' || argmode[i] == 'b') {
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

                  // Need to update the func_obj variable from sqlite database if available
                  if (func_args_data.length != 0) {
                    for (let i = 0; i < func_args_data.length; i++) {
                      let index = func_args_data[i]['arg_id'];
                      let values = [];
                      if (argtype[index].indexOf('[]') != -1) {
                        let vals = func_args_data[i]['value'].split(',');
                        _.each(vals, function(val) {
                          values.push({
                            'value': val,
                          });
                        });
                      } else {
                        values = func_args_data[i]['value'];
                      }
                      func_obj.push({
                        'name': myargname[index],
                        'type': argtype[index],
                        'is_null': func_args_data[i]['is_null'] ? true : false,
                        'expr': func_args_data[i]['is_expression'] ? true : false,
                        'value': values,
                        'use_default': func_args_data[i]['use_default'] ? true : false,
                        'default_value': def_val_list[index],
                      });
                    }
                  }
                }
              }
            }

            // Check if the arguments already available in the sqlite database
            // then we should use the existing arguments
            if (func_args_data.length == 0) {
              this.profilerInputArgsColl =
                new ProfilerInputArgCollections(my_obj);
            } else {
              this.profilerInputArgsColl =
                new ProfilerInputArgCollections(func_obj);
            }

            // Initialize a new Grid instance
            if (this.grid) {
              this.grid.remove();
              this.grid = null;
            }
            const grid = this.grid = new Backgrid.Grid({
              columns: gridCols,
              collection: this.profilerInputArgsColl,
              className: 'backgrid table table-bordered table-noouter-border table-bottom-border',
            });

            grid.render();
            $(this.elements.content).html(grid.el);

            // For keyboard navigation in the grid
            // we'll set focus on checkbox from the first row if any
            const grid_checkbox = $(grid.el).find('input:checkbox').first();
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
          
          /**
           * Callback function that fires when one of the Alertify dialog options are chosen.
           * Determines which option was chosen. If the 'Profile' option was chosen, then the
           * profiling options will be sent to the server and be used to create a new
           * direct profiling instance
           *
           * @param {Object} e the event object that was fired
           *
           * @returns {boolean} true if the 'Profile' button was selected and server correctly
           *                    created a profiling instance
           */
          callback: function(e) {
            if (e.button.text === gettext('Profile')) {
              // Initialize the target once the profile button is clicked and
              // create asynchronous connection and unique transaction ID
              const self = this;

              // If the profiling is started again then treeInfo is already
              // stored in this.data so we can use the same.
              let treeInfo = void 0;
              let i = void 0;
              let d = void 0;
              if (self.setting('restart_profile') == 0) {
                const t = pgBrowser.tree;
                i = t.selected();
                d = i && i.length == 1 ? t.itemData(i) : void 0;
                let node = d && pgBrowser.Nodes[d._type];

                if (!d)
                  return;

                treeInfo = node.getTreeNodeHierarchy.apply(node, [i]);
              }

              const args_value_list = [];
              const sqlite_func_args_list = this.sqlite_func_args_list = [];
              let int_count = 0;

              // Store arguments values into args_value_list
              this.grid.collection.each(function(m) {

                // Check if value is set to NULL then we should ignore the value field
                if (m.get('is_null')) {
                  args_value_list.push({
                    'name': m.get('name'),
                    'type': m.get('type'),
                    'value': 'NULL',
                  });
                } else {
                  // Check if default value to be used or not
                  if (m.get('use_default')) {
                    args_value_list.push({
                      'name': m.get('name'),
                      'type': m.get('type'),
                      'value': m.get('default_value'),
                    });
                  } else {
                    args_value_list.push({
                      'name': m.get('name'),
                      'type': m.get('type'),
                      'value': m.get('value'),
                    });
                  }
                }

                if (self.setting('restart_profile') == 0) {
                  let f_id = void 0;
                  if (d._type == 'function') {
                    f_id = treeInfo.function._id;
                  } else if (d._type == 'procedure') {
                    f_id = treeInfo.procedure._id;
                  }

                  // Below will format the data to be stored in sqlite database
                  sqlite_func_args_list.push({
                    'server_id': treeInfo.server._id,
                    'database_id': treeInfo.database._id,
                    'schema_id': treeInfo.schema._id,
                    'function_id': f_id,
                    'arg_id': self.input_arg_id[int_count],
                    'is_null': m.get('is_null') ? 1 : 0,
                    'is_expression': m.get('expr') ? 1 : 0,
                    'use_default': m.get('use_default') ? 1 : 0,
                    'value': m.get('value'),
                  });
                } else {
                  // Below will format the data to be stored in sqlite database
                  sqlite_func_args_list.push({
                    'server_id': self.setting('profile_info').server_id,
                    'database_id': self.setting('profile_info').database_id,
                    'schema_id': self.setting('profile_info').schema_id,
                    'function_id': self.setting('profile_info').function_id,
                    'arg_id': self.input_arg_id[int_count],
                    'is_null': m.get('is_null') ? 1 : 0,
                    'is_expression': m.get('expr') ? 1 : 0,
                    'use_default': m.get('use_default') ? 1 : 0,
                    'value': m.get('value'),
                  });
                }

                int_count = int_count + 1;
              });

              let baseUrl = void 0;

              // TODO: At this point, we are assuming that profiling is not starting again
              if (self.setting('restart_profile') == 0) {
                if (d._type == 'function') {
                  baseUrl = url_for('profiler.initialize_target_for_function', {
                    'profile_type': 'direct',
                    'trans_id': self.setting('trans_id'),
                    'sid': treeInfo.server._id,
                    'did': treeInfo.database._id,
                    'scid': treeInfo.schema._id,
                    'func_id': treeInfo.function._id,
                  });
                } else if (d._type == 'procedure') {
                  baseUrl = url_for('profiler.initialize_target_for_function', {
                    'profile_type': 'direct',
                    'trans_id': self.setting('trans_id'),
                    'sid': treeInfo.server._id,
                    'did': treeInfo.database._id,
                    'scid': treeInfo.schema._id,
                    'func_id': treeInfo.procedure._id,
                  });
                }

                $.ajax({
                  url: baseUrl,
                  method: 'POST',
                  data: {
                    'data': JSON.stringify(args_value_list),
                  },
                })
                  .done(function(res) {
                    const url = url_for(
                      'profiler.profile', {
                        'trans_id': res.data.profilerTransId,
                      }
                    );

                    if (self.preferences.profiler_new_browser_tab) {
                      window.open(url, '_blank');
                    }  else  {
                      pgBrowser.Events.once(
                        'pgadmin-browser:frame:urlloaded:frm_profiler',
                        function(frame) {
                          frame.openURL(url);
                        });

                      // Create the profiler panel as per the data received from user input dialog.
                      const dashboardPanel = pgBrowser.docker.findPanels('properties'),
                        panel = pgBrowser.docker.addPanel(
                          'frm_profiler', wcDocker.DOCK.STACKED, dashboardPanel[0]
                        );

                      panel.focus();

                      // Panel Closed event
                      panel.on(wcDocker.EVENT.CLOSED, function() {
                        let closeUrl = url_for('profiler.close', {
                          'trans_id': res.data.profilerTransId,
                        });
                        $.ajax({
                          url: closeUrl,
                          method: 'DELETE',
                        });
                      });
                    }

                    let _Url = '';

                    if (d._type == 'function') {
                      _Url = url_for('profiler.set_arguments', {
                        'sid': treeInfo.server._id,
                        'did': treeInfo.database._id,
                        'scid': treeInfo.schema._id,
                        'func_id': treeInfo.function._id,
                      });
                    } else if (d._type == 'procedure') {
                      _Url = url_for('profiler.set_arguments', {
                        'sid': treeInfo.server._id,
                        'did': treeInfo.database._id,
                        'scid': treeInfo.schema._id,
                        'func_id': treeInfo.procedure._id,
                      });
                    }

                    $.ajax({
                      url: _Url,
                      method: 'POST',
                      data: {
                        'data': JSON.stringify(sqlite_func_args_list),
                      },
                    })
                      .done(function() {})
                      .fail(function() {
                        Alertify.alert(
                          gettext('Profiler error'),
                          gettext('Unable to set the arguments on the server')
                        );
                      });
                  })
                  .fail(function(e) {
                    Alertify.alert(
                      gettext('Profiler Target Initialization Error'),
                      e.responseJSON.errormsg
                    );
                  });
              } else {
                // If the profiling is starting again, all we need to do is set the arguments
                // and run the profile

                const _Url = url_for('profiler.set_arguments', {
                  'sid': profile_info.server_id,
                  'did': profile_info.database_id,
                  'scid': profile_info.schema_id,
                  'func_id': profile_info.function_id,
                });
                $.ajax({
                  url: _Url,
                  method: 'POST',
                  data: {
                    'data': JSON.stringify(sqlite_func_args_list),
                  },
                })
                  .done(function() {
                    pgAdmin.Tools.Profile.constructor.prototype.startEx(self.setting('trans_id'));
                  })
                  .fail(function() {
                    Alertify.alert(
                      gettext('Profiler error'),
                      gettext('Unable to set the arguments on the server')
                    );
                  });
              }

              return true;
            }

            if (e.button.text === gettext('Cancel') && this.setting('restart_profile') === 0) {
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
            this.grid.listenTo(this.profilerInputArgsColl, 'backgrid:edited',
              (function(obj) {

                return function() {

                  let enable_btn = false;

                  for (let i = 0; i < this.collection.length; i++) {

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
      gettext('Profiler'), profile_info, restart_profile, trans_id
    ).resizeTo(pgBrowser.stdW.md,pgBrowser.stdH.md);
  };

  return res;
});
