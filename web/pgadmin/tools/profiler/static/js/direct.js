/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2019, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

define([
  'sources/gettext', 'sources/url_for', 'jquery', 'underscore',
  'pgadmin.alertifyjs', 'sources/pgadmin', 'pgadmin.browser', 'backbone',
  'pgadmin.backgrid', 'pgadmin.backform', 'sources/../bundle/codemirror',
  'pgadmin.tools.profiler.ui', 'sources/keyboard_shortcuts',
  'pgadmin.tools.profiler.utils', 'wcdocker',
], function(
  gettext, url_for, $, _, Alertify, pgAdmin, pgBrowser, Backbone, Backgrid,
  Backform, codemirror, profile_function_again, keyboardShortcuts, profilerUtils
) {

  var CodeMirror = codemirror.default,
    wcDocker = window.wcDocker;

  if (pgAdmin.Browser.tree != null) {
    pgAdmin = pgAdmin || window.pgAdmin || {};
  }

  var pgTools = pgAdmin.Tools = pgAdmin.Tools || {};

  if (pgTools.DirectProfile)
    return pgTools.DirectProfile;

  var controller = new(function() {});

  _.extend(
    controller, Backbone.Events, {
      enable: function(btn, enable) {
        // trigger the event and change the button view to enable/disable the buttons for profiling
        this.trigger('pgProfiler:button:state:' + btn, enable);
      },

      enable_toolbar_buttons: function() {
        var self = this;
        self.enable('start', true);
        self.enable('stop' , true);
        self.enable('save' , true);
      },

      disable_toolbar_buttons: function() {
        var self = this;
        self.enable('start', false);
        self.enable('stop' , false);
        self.enable('save' , false);
      },

      // Function to profile
      start_execution: function(trans_id, port_num) {
        console.warn(trans_id);
        console.warn(port_num);

        var self = this;

        // Make ajax call to listen the database message
        var baseUrl = url_for(
          'profiler.start_execution', {
            'trans_id': trans_id,
            'port_num': port_num,
          });
        $.ajax({
          url: baseUrl,
          method: 'GET',
        })
          .done(function(res) {
            if (res.data.status === 'Success') {
              // If status is Success then open the generated html report
              // self.execute_query(trans_id);
              window.open(, _blank);
            } else if (res.data.status === 'NotConnected') {
              Alertify.alert(
                gettext('Profiler Error'),
                gettext('Error while starting profiling session.')
              );
            }
          })
          .fail(function() {
            Alertify.alert(
              gettext('Profiler Error'),
              gettext('Error while starting profiling session.')
            );
          });
      },

      // Execute the query and get the first functions profile information from the server
      execute_query: function(trans_id) {
        console.warn(trans_id);
        /*
        var self = this;
        // Make ajax call to listen the database message
        var baseUrl = url_for(
          'profiler.execute_query', {
            'trans_id': trans_id,
            'query_type': 'wait_for_breakpoint',
          });
        */
        /*$.ajax({
          url: baseUrl,
          method: 'GET',
        })
          .done(function(res) {
            if (res.data.status === 'Success') {
            // set the return code to the code editor text area
              if (
                res.data.result[0].src != null &&
              res.data.result[0].linenumber != null
              ) {
                pgTools.DirectProfile.editor.setValue(res.data.result[0].src);

                self.setActiveLine(res.data.result[0].linenumber - 2);
              }
              // Call function to create and update local variables ....
              self.GetStackInformation(trans_id);
              if (pgTools.DirectProfile.profile_type) {
                self.poll_end_execution_result(trans_id);
              }
            } else if (res.data.status === 'NotConnected') {
              Alertify.alert(
                gettext('Profiler Error'),
                gettext('Error while executing requested profiling information.')
              );
            }
          })
          .fail(function() {
            Alertify.alert(
              gettext('Profiler Error'),
              gettext('Error while executing requested profiling information.')
            );
          });
        */
      },


      /*
        poll the actual result after user has executed the "continue", "step-into",
        "step-over" actions and get the other updated information from the server.
      */
      poll_result: function(trans_id) {
        console.warn(trans_id);
        /*
        var self = this;

        // Do we need to poll?
        if (!pgTools.DirectProfile.is_polling_required) {
          return;
        }

        // Make ajax call to listen the database message
        var baseUrl = url_for('profiler.poll_result', {
            'trans_id': trans_id,
          }),
          poll_timeout;
        */

        /*
          During the execution we should poll the result in minimum seconds but
          once the execution is completed and wait for the another profiling
          session then we should decrease the polling frequency.
        */
        /*
        if (pgTools.DirectProfile.polling_timeout_idle) {
          // Poll the result after 1 second
          poll_timeout = 1000;
        } else {
          // Poll the result after 200 ms
          poll_timeout = 200;
        }

        setTimeout(
          function() {
            $.ajax({
              url: baseUrl,
              method: 'GET',
              beforeSend: function(xhr) {
                xhr.setRequestHeader(
                  pgAdmin.csrf_token_header, pgAdmin.csrf_token
                );
              },
            })
              .done(function(res) {

                if (res.data.status === 'Success') {
                // If no result then poll again to wait for results.
                  if (res.data.result == null || res.data.result.length == 0) {
                    self.poll_result(trans_id);
                  } else {
                    if (res.data.result[0].src != undefined || res.data.result[0].src != null) {
                      pgTools.DirectProfile.polling_timeout_idle = false;
                      pgTools.DirectProfile.docker.finishLoading(50);
                      if (res.data.result[0].src != pgTools.DirectProfile.editor.getValue()) {
                        pgTools.DirectProfile.editor.setValue(res.data.result[0].src);
                        self.UpdateBreakpoint(trans_id);
                      }
                      self.setActiveLine(res.data.result[0].linenumber - 2);
                      // Update the stack, local variables and parameters information
                      self.GetStackInformation(trans_id);

                    } else if (!pgTools.DirectProfile.profile_type && !pgTools.DirectProfile.first_time_indirect_profile) {
                      pgTools.DirectProfile.docker.finishLoading(50);
                      self.setActiveLine(-1);
                      self.clear_all_breakpoint(trans_id);
                      self.execute_query(trans_id);
                      pgTools.DirectProfile.first_time_indirect_profile = true;
                      pgTools.DirectProfile.polling_timeout_idle = false;
                    } else {
                      pgTools.DirectProfile.polling_timeout_idle = false;
                      pgTools.DirectProfile.docker.finishLoading(50);
                      // If the source is really changed then only update the breakpoint information
                      if (res.data.result[0].src != pgTools.DirectProfile.editor.getValue()) {
                        pgTools.DirectProfile.editor.setValue(res.data.result[0].src);
                        self.UpdateBreakpoint(trans_id);
                      }

                      self.setActiveLine(res.data.result[0].linenumber - 2);
                      // Update the stack, local variables and parameters information
                      self.GetStackInformation(trans_id);
                    }

                    // Enable all the buttons as we got the results
                    // TODO: Fix this properly so a timeout isn't required.
                    setTimeout(function() {
                      self.enable_toolbar_buttons();
                    }, 500);
                  }
                } else if (res.data.status === 'Busy') {
                  pgTools.DirectProfile.polling_timeout_idle = true;
                  // If status is Busy then poll the result by recursive call to the poll function
                  if (!pgTools.DirectProfile.profile_type) {
                    pgTools.DirectProfile.docker.startLoading(
                      gettext('Waiting for another session to invoke the target...')
                    );

                    // As we are waiting for another session to invoke the target,disable all the buttons
                    self.disable_toolbar_buttons();
                    pgTools.DirectProfile.first_time_indirect_profile = false;
                    self.poll_result(trans_id);
                  } else {
                    self.poll_result(trans_id);
                  }
                } else if (res.data.status === 'NotConnected') {
                  Alertify.alert(
                    gettext('Profiler Error'),
                    gettext('Error while polling result.')
                  );
                }
              })
              .fail(function() {
                Alertify.alert(
                  gettext('Profiler Error'),
                  gettext('Error while polling result.')
                );
              });
          }, poll_timeout);
        */
      },

      // This function will update messages tab
      update_messages: function(msg) {
        // To prevent xss
        msg = _.escape(msg);

        var old_msgs = '',
          new_msgs = '';
        old_msgs = pgTools.DirectProfile.messages_panel.$container.find('.messages').html();
        if (old_msgs) {
          new_msgs = (old_msgs + '\n' + msg)
            .replace(/(?:\r\n|\r|\n)/g, '<br />') // Newlines with <br>
            .replace(/(<br\ ?\/?>)+/g, '<br />'); // multiple <br> with single <br>
        } else {
          new_msgs = msg;
        }
        pgTools.DirectProfile.messages_panel.$container.find('.messages').html(new_msgs);
      },

      /*
        For the direct profiling, we need to check weather the functions execution
        is completed or not. After completion of the profiling, we will stop polling
        the result  until new execution starts.
      */
      poll_end_execution_result: function(trans_id) {
        console.warn(trans_id);
        /*
        var self = this;

        // Do we need to poll?
        if (!pgTools.DirectProfile.is_polling_required) {
          return;
        }

        // Make ajax call to listen the database message
        var baseUrl = url_for('profiler.poll_end_execution_result', {
            'trans_id': trans_id,
          }),
          poll_end_timeout;
        */

        /*
         * During the execution we should poll the result in minimum seconds
         * but once the execution is completed and wait for the another
         * profiling session then we should decrease the polling frequency.
         */
        /*
        if (pgTools.DirectProfile.polling_timeout_idle) {
          // Poll the result to check that execution is completed or not
          // after 1200 ms
          poll_end_timeout = 1200;
        } else {
          // Poll the result to check that execution is completed or not
          // after 350 ms
          poll_end_timeout = 250;
        }

        setTimeout(
          function() {
            $.ajax({
              url: baseUrl,
              method: 'GET',
            })
              .done(function(res) {
                if (res.data.status === 'Success') {
                  if (res.data.result == undefined) {
                  /*
                   "result" is undefined only in case of EDB procedure.
                   As Once the EDB procedure execution is completed then we are
                   not getting any result so we need ignore the result.

                    self.setActiveLine(-1);
                    pgTools.DirectProfile.direct_execution_completed = true;
                    pgTools.DirectProfile.polling_timeout_idle = true;

                    //Set the alertify message to inform the user that execution is completed.
                    Alertify.success(res.info, 3);

                    // Update the message tab of the profiler
                    if (res.data.status_message) {
                      self.update_messages(res.data.status_message);
                    }

                    // Execution completed so disable the buttons other than
                    // "Continue/Start" button because user can still
                    // start the same execution again.
                    setTimeout(function() {
                      self.enable('start', false);
                      self.enable('stop', false);
                      self.enable('save', false);
                    }, 500);

                    // Stop further polling
                    pgTools.DirectProfile.is_polling_required = false;
                  } else {
                  // Call function to create and update local variables ....
                    if (res.data.result != null) {
                      self.setActiveLine(-1);
                      self.AddResults(res.data.col_info, res.data.result);
                      pgTools.DirectProfile.results_panel.focus();
                      pgTools.DirectProfile.direct_execution_completed = true;
                      pgTools.DirectProfile.polling_timeout_idle = true;

                      //Set the alertify message to inform the user that execution is completed.
                      Alertify.success(res.info, 3);

                      // Update the message tab of the profiler
                      if (res.data.status_message) {
                        self.update_messages(res.data.status_message);
                      }

                      // Execution completed so disable the buttons other than
                      // "Continue/Start" button because user can still
                      // start the same execution again.
                      setTimeout(function() {
                        self.enable('start', false);
                        self.enable('stop', false);
                        self.enable('save', false);
                      }, 500);

                      // Stop further pooling
                      pgTools.DirectProfile.is_polling_required = false;
                    }
                  }
                } else if (res.data.status === 'Busy') {
                // If status is Busy then poll the result by recursive call to
                // the poll function
                  self.poll_end_execution_result(trans_id);
                  // Update the message tab of the profiler
                  if (res.data.status_message) {
                    self.update_messages(res.data.status_message);
                  }
                } else if (res.data.status === 'NotConnected') {
                  Alertify.alert(
                    gettext('Profiler poll end execution error'),
                    res.data.result
                  );
                } else if (res.data.status === 'ERROR') {
                  pgTools.DirectProfile.direct_execution_completed = true;
                  self.setActiveLine(-1);

                  //Set the Alertify message to inform the user that execution is
                  // completed with error.
                  if (!pgTools.DirectProfile.is_user_aborted_profiling) {
                    Alertify.error(res.info, 3);
                  }

                  // Update the message tab of the profiler
                  if (res.data.status_message) {
                    self.update_messages(res.data.status_message);
                  }

                  pgTools.DirectProfile.messages_panel.focus();

                  // Execution completed so disable the buttons other than
                  // "Continue/Start" button because user can still start the
                  // same execution again.
                  self.enable('stop', false);
                  self.enable('step_over', false);
                  self.enable('step_into', false);
                  self.enable('toggle_breakpoint', false);
                  self.enable('clear_all_breakpoints', false);
                  // If profiling is stopped by user then do not enable
                  // continue/restart button
                  if (!pgTools.DirectProfile.is_user_aborted_profiling) {
                    self.enable('continue', true);
                    pgTools.DirectProfile.is_user_aborted_profiling = false;
                  }

                  // Stop further pooling
                  pgTools.DirectProfile.is_polling_required = false;
                }
              })
              .fail(function() {
                Alertify.alert(
                  gettext('Profiler Error'),
                  gettext('Error while polling result.')
                );
              });
          }, poll_end_timeout);
        */
      },

      Restart: function(trans_id) {
        console.warn(trans_id);
        /*

        var self = this,
          baseUrl = url_for('profiler.restart', {'trans_id': trans_id});

        self.disable_toolbar_buttons();

        // Clear msg tab
        pgTools.DirectProfile
          .messages_panel
          .$container
          .find('.messages')
          .html('');

        /*
        $.ajax({
          url: baseUrl,
        })
          .done(function(res) {
          // Restart the same function profiling with previous arguments
            var restart_pfl = res.data.restart_profile ? 1 : 0;

            // Start pooling again
            pgTools.DirectProfile.polling_timeout_idle = false;
            pgTools.DirectProfile.is_polling_required = true;
            self.poll_result(trans_id);

            if (restart_pfl) {
              pgTools.DirectProfile.profile_restarted = true;
            }

            /*
           Need to check if restart profiling really require to open the input
           dialog? If yes then we will get the previous arguments from database
           and populate the input dialog, If no then we should directly start the
           listener.

            if (res.data.result.require_input) {
              profile_function_again(res.data.result, restart_pfl);
            } else {
            // Profiling of void function is started again so we need to start
            // the listener again
              var baseUrl = url_for('profiler.start_listener', {
                'trans_id': trans_id,
              });

              $.ajax({
                url: baseUrl,
                method: 'GET',
              })
                .done(function() {
                  if (pgTools.DirectProfile.profile_type) {
                    self.poll_end_execution_result(trans_id);
                  }
                })
                .fail(function() {
                  Alertify.alert(
                    gettext('Profiler Error'),
                    gettext('Error while polling result.')
                  );
                });
            }
          })
          .fail(function(xhr) {
            try {
              var err = JSON.parse(xhr.responseText);
              if (err.success == 0) {
                Alertify.alert(gettext('Profiler Error'), err.errormsg);
              }
            } catch (e) {
              console.warn(e.stack || e);
            }
          });
        */
      },

      Stop: function(trans_id) {
        console.warn(trans_id);
        /*
        var self = this;
        self.disable_toolbar_buttons();

        // Make ajax call to listen the database message
        var baseUrl = url_for(
          'profiler.execute_query', {
            'trans_id': trans_id,
            'query_type': 'abort_target',
          });
        /*
        $.ajax({
          url: baseUrl,
          method: 'GET',
        })
          .done(function(res) {
            if (res.data.status) {
            // Call function to create and update local variables ....
              self.setActiveLine(-1);
              pgTools.DirectProfile.direct_execution_completed = true;
              pgTools.DirectProfile.is_user_aborted_profiling = true;

              // Stop further pooling
              pgTools.DirectProfile.is_polling_required = false;

              // Restarting profiling in the same transaction do not work
              // We will give same behaviour as pgAdmin3 and disable all buttons
              self.enable('continue', false);

              // Set the Alertify message to inform the user that execution
              // is completed.
              Alertify.success(res.info, 3);
            } else if (res.data.status === 'NotConnected') {
              Alertify.alert(
                gettext('Profiler Error'),
                gettext('Error while executing stop in profiling session.')
              );
            }
          })
          .fail(function() {
            Alertify.alert(
              gettext('Profiler Error'),
              gettext('Error while executing stop in profiling session.')
            );
          });
        */
      },

      AddResults: function(columns, result) {
        var self = this;

        // Remove the existing created grid and update the result values
        if (self.result_grid) {
          self.result_grid.remove();
          self.result_grid = null;
        }

        var ProfilerResultsModel = Backbone.Model.extend({
          defaults: {
            name: undefined,
          },
        });

        // Collection which contains the model for function informations.
        var ResultsCollection = Backbone.Collection.extend({
          model: ProfilerResultsModel,
        });

        var resultGridCols = [];
        if (_.size(columns)) {
          _.each(columns, function(c) {
            var column = {
              type: 'text',
              editable: false,
              cell: 'string',
            };
            column['name'] = column['label'] = c.name;
            resultGridCols.push(column);
          });
        }

        // Initialize a new Grid instance
        var result_grid = this.result_grid = new Backgrid.Grid({
          emptyText: 'No data found',
          columns: resultGridCols,
          collection: new ResultsCollection(result),
          className: 'backgrid table table-bordered table-noouter-border table-bottom-border',
        });

        result_grid.render();

        // Render the result grid into result panel
        pgTools.DirectProfile.results_panel
          .$container
          .find('.profile_results')
          .append(result_grid.el);
      },

      AddParameters: function(result) {
        var self = this;

        // Remove the existing created grid and update the parameter values
        if (self.param_grid) {
          self.param_grid.remove();
          self.param_grid = null;
        }

        var ProfilerParametersModel = Backbone.Model.extend({
          defaults: {
            name: undefined,
            type: undefined,
            value: undefined,
          },
        });

        // Collection which contains the model for function informations.
        var ParametersCollection = self.ParametersCollection = Backbone.Collection.extend({
          model: ProfilerParametersModel,
        });

        ParametersCollection.prototype.on(
          'change', self.deposit_parameter_value, self
        );

        var paramGridCols = [{
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
          name: 'value',
          label: gettext('Value'),
          type: 'text',
          cell: 'string',
        },
        ];

        var param_obj = [];
        if (result.length != 0) {
          for (var i = 0; i < result.length; i++) {
            if (result[i].varclass == 'A') {
              param_obj.push({
                'name': result[i].name,
                'type': result[i].dtype,
                'value': result[i].value,
              });
            }
          }
        }

        // Initialize a new Grid instance
        var param_grid = this.param_grid = new Backgrid.Grid({
          emptyText: 'No data found',
          columns: paramGridCols,
          collection: new ParametersCollection(param_obj),
          className: 'backgrid table table-bordered table-noouter-border table-bottom-border',
        });

        param_grid.collection.on(
          'backgrid:edited', (ch1, ch2, command) => {
            profilerUtils.setFocusToProfilerEditor(
              pgTools.DirectProfile.editor, command
            );
          }
        );

        param_grid.render();

        // Render the parameters grid into parameter panel
        pgTools.DirectProfile.parameters_panel
          .$container
          .find('.parameters')
          .append(param_grid.el);
      },
      deposit_parameter_value: function(model) {
        console.warn(model);
        /*var self = this;

        // variable name and value list that is changed by user
        var name_value_list = [];

        name_value_list.push({
          'name': model.get('name'),
          'type': model.get('type'),
          'value': model.get('value'),
        });

        // Make ajax call to listen the database message
        var baseUrl = url_for('profiler.deposit_value', {
          'trans_id': pgTools.DirectProfile.trans_id,
        });
        /*
        $.ajax({
          url: baseUrl,
          method: 'POST',
          data: {
            'data': JSON.stringify(name_value_list),
          },
        })
          .done(function(res) {
            if (res.data.status) {
            // Get the updated variables value
              self.GetLocalVariables(pgTools.DirectProfile.trans_id);
              // Show the message to the user that deposit value is success or failure
              if (res.data.result) {
                Alertify.success(res.data.info, 3);
              } else {
                Alertify.error(res.data.info, 3);
              }
            }
          })
          .fail(function() {
            Alertify.alert(
              gettext('Profiler Error'),
              gettext('Error while depositing variable value.')
            );
          });
        */
      },

      select_frame: function() {
        console.warn('a');
        /*
        var self = this;

        // Make ajax call to listen the database message
        var baseUrl = url_for('profiler.select_frame', {
          'trans_id': pgTools.DirectProfile.trans_id,
          'frame_id': self.frame_id,
        });
        /*
        $.ajax({
          url: baseUrl,
          method: 'GET',
        })
          .done(function(res) {
            if (res.data.status) {
              pgTools.DirectProfile.editor.setValue(res.data.result[0].src);
              self.UpdateBreakpoint(pgTools.DirectProfile.trans_id);
              self.setActiveLine(res.data.result[0].linenumber - 2);
              // Call function to create and update local variables ....
              self.GetLocalVariables(pgTools.DirectProfile.trans_id);
            }
          })
          .fail(function() {
            Alertify.alert(
              gettext('Profiler Error'),
              gettext('Error while selecting frame.')
            );
          });
        */
      },
    }
  );

  /*
    Profiler tool var view to create the button toolbar and listen to the button click event and inform the
    controller about the click and controller will take the action for the specified button click.
  */
  var ProfilerToolbarView = Backbone.View.extend({
    el: '.profiler_main_container',
    initialize: function() {
      controller.on('pgProfiler:button:state:start', this.enable_start, this);
      controller.on('pgProfiler:button:state:stop' , this.enable_stop, this);
      controller.on('pgProfiler:button:state:save' , this.enable_save, this);
    },
    events: {
      'click .btn-start': 'on_start',
      'click .btn-stop' : 'on stop',
      'click .btn-save' : 'on_save',
      'keydown': 'keyAction',
    },
    enable_start: function(enable) {
      var $btn = this.$el.find('.btn-start');

      if (enable) {
        $btn.prop('disabled', false);
        $btn.removeAttr('disabled');
      } else {
        $btn.prop('disabled', true);
        $btn.attr('disabled', 'disabled');
      }
    },
    enable_stop: function(enable) {
      var $btn = this.$el.find('.btn-stop');

      if (enable) {
        $btn.prop('disabled', false);
        $btn.removeAttr('disabled');
      } else {
        $btn.prop('disabled', true);
        $btn.attr('disabled', 'disabled');
      }
    },
    enable_save: function(enable) {
      var $btn = this.$el.find('.btn-save');

      if (enable) {
        $btn.prop('disabled', false);
        $btn.removeAttr('disabled');
      } else {
        $btn.prop('disabled', true);
        $btn.attr('disabled', 'disabled');
      }
    },
    on_start: function() {
      controller.start(pgTools.DirectProfile.trans_id);
    },
    on_stop: function() {
      controller.stop(pgTools.DirectProfile.trans_id);
    },
    on_save: function() {
      controller.save(pgTools.DirectProfile.trans_id);
    },
    keyAction: function (event) {
      let panel_type='';

      panel_type = keyboardShortcuts.processEventProfiler(
        this.$el, event, this.preferences, pgTools.DirectProfile.docker
      );


      if(!_.isNull(panel_type) && !_.isUndefined(panel_type) && panel_type != '') {
        setTimeout(function() {
          pgBrowser.Events.trigger(`pgadmin:profiler:${panel_type}:focus`);
        }, 100);
      }
    },
  });


  /*
    Function is responsible to create the new wcDocker instance for profiler and
    initialize the profiler panel inside the docker instance.
  */
  var DirectProfile = function() {};

  _.extend(DirectProfile.prototype, {
    /* We should get the transaction id from the server during initialization here */
    load: function(trans_id, profile_type, function_name_with_arguments, layout) {
      console.warn(trans_id);
      console.warn(profile_type);
      console.warn(function_name_with_arguments);
      console.warn(layout);
      /*
      // We do not want to initialize the module multiple times.
      var self = this;
      _.bindAll(pgTools.DirectProfile, 'messages');
      */

      if (this.initialized)
        return;

      //var baseUrl;

      this.initialized = true;
      this.trans_id = trans_id;
      this.profile_type = profile_type;
      this.first_time_indirect_profile = false;
      this.direct_execution_completed = false;
      this.polling_timeout_idle = false;
      this.profile_restarted = false;
      this.is_user_aborted_profiling = false;
      this.is_polling_required = true; // Flag to stop unwanted ajax calls
      this.function_name_with_arguments = function_name_with_arguments;
      this.layout = layout;

      let browser = window.opener ?
        window.opener.pgAdmin.Browser : window.top.pgAdmin.Browser;
      this.preferences = browser.get_preferences_for_module('profiler');

      this.docker = new wcDocker(
        '#container', {
          allowContextMenu: false,
          allowCollapse: false,
          loadingClass: 'pg-sp-icon',
          themePath: url_for('static', {
            'filename': 'css',
          }),
          theme: 'webcabin.overrides.css',
        });
      this.panels = [];

      pgBrowser.bind_beforeunload();
      this.initializePanels();
      console.warn('a');

      // Direct profiling
      if (trans_id != undefined && profile_type) {

      }

      // Below code will be executed for indirect profiling
      // indirect profiling - 0  and for direct profiling - 1
      if (trans_id != undefined && !profile_type) {
        // Make ajax call to execute the and start the target for execution
        //baseUrl = url_for('profiler.start_listener', {
        //  'trans_id': trans_id,
        //});

        /*
        $.ajax({
          url: baseUrl,
          method: 'GET',
        })
          .done(function(res) {
            if (res.data.status) {
              self.initializePanels();
              controller.enable_toolbar_buttons();
              controller.poll_result(trans_id);
            }
          })
          .fail(function(xhr) {
            try {
              var err = JSON.parse(xhr.responseText);
              if (err.success == 0) {
                Alertify.alert(gettext('Profiler Error'), err.errormsg);
              }
            } catch (e) {
              Alertify.alert(
                gettext('Profiler Error'),
                gettext('Error while starting profiling listener.')
              );
            }
          });

        */
      } else if (trans_id != undefined && profile_type) {

        // Make ajax call to execute the and start the target for execution
        /*
        baseUrl = url_for('profiler.start_listener', {
          'trans_id': trans_id,
        });

        /*
        $.ajax({
          url: baseUrl,
          method: 'GET',
        })
          .done(function(res) {
            if (res.data.status) {
              self.messages(trans_id);
            }
          })
          .fail(function(xhr) {
            try {
              var err = JSON.parse(xhr.responseText);
              if (err.success == 0) {
                Alertify.alert(gettext('Profiler Error'), err.errormsg);
              }
            } catch (e) {
              Alertify.alert(
                gettext('Profiler Error'),
                gettext('Error while starting profiling listener.')
              );
            }
          });
          */
      } else {
        //this.initializePanels();
      }
    },

    // Read the messages of the database server and get the port ID and attach
    // the executer to that port.
    messages: function(trans_id) {
      console.warn(trans_id);
      /*var self = this;
      // Make ajax call to listen the database message
      var baseUrl = url_for('profiler.messages', {
        'trans_id': trans_id,
      });*/
      /*

      $.ajax({
        url: baseUrl,
        method: 'GET',
      })
        .done(function(res) {
          if (res.data.status === 'Success') {
            self.initializePanels();
            controller.enable_toolbar_buttons();
            // If status is Success then find the port number to attach the executer.
            controller.start_execution(trans_id, res.data.result);
          } else if (res.data.status === 'Busy') {
          // If status is Busy then poll the result by recursive call to the poll function
            self.messages(trans_id);
          } else if (res.data.status === 'NotConnected') {
            Alertify.alert(
              gettext('Not connected to server or connection with the server has been closed.'),
              res.data.result
            );
          }
        })
        .fail(function() {
          Alertify.alert(
            gettext('Profiler Error'),
            gettext('Error while fetching messages information.')
          );
        });
        */

    },

    buildDefaultLayout: function(docker) {
      let code_editor_panel = docker.addPanel('code', wcDocker.DOCK.TOP);

      let parameters_panel = docker.addPanel('parameters', wcDocker.DOCK.BOTTOM, code_editor_panel);
      docker.addPanel('messages',wcDocker.DOCK.STACKED, parameters_panel, {
        tabOrientation: wcDocker.TAB.TOP,
      });
      docker.addPanel('results', wcDocker.DOCK.STACKED, parameters_panel);
    },

    // Create the profiler layout with splitter and display the appropriate data received from server.
    initializePanels: function() {
      var self = this;
      this.registerPanel(
        'code', self.function_name_with_arguments, '100%', '50%',
        function() {

          // Create the parameters panel to display the arguments of the functions
          var parameters = new pgAdmin.Browser.Panel({
            name: 'parameters',
            title: gettext('Parameters'),
            width: '100%',
            height: '100%',
            isCloseable: false,
            isPrivate: true,
            content: '<div id ="parameters" class="parameters" tabindex="0"></div>',
          });

          // Create the messages panel to display the message returned from the database server
          var messages = new pgAdmin.Browser.Panel({
            name: 'messages',
            title: gettext('Messages'),
            width: '100%',
            height: '100%',
            isCloseable: false,
            isPrivate: true,
            content: '<div id="messages" class="messages" tabindex="0"></div>',
          });

          // Create the result panel to display the result after profiling the function
          var results = new pgAdmin.Browser.Panel({
            name: 'results',
            title: gettext('Results'),
            width: '100%',
            height: '100%',
            isCloseable: false,
            isPrivate: true,
            content: '<div id="profile_results" class="profile_results" tabindex="0"></div>',
          });

          // Load all the created panels
          parameters.load(self.docker);
          messages.load(self.docker);
          results.load(self.docker);
        });

      // restore the layout if present else fallback to buildDefaultLayout
      pgBrowser.restore_layout(self.docker, self.layout, this.buildDefaultLayout.bind(this));

      self.docker.on(wcDocker.EVENT.LAYOUT_CHANGED, function() {
        pgBrowser.save_current_layout('Profiler/Layout', self.docker);
      });

      self.code_editor_panel = self.docker.findPanels('code')[0];
      self.parameters_panel = self.docker.findPanels('parameters')[0];
      self.messages_panel = self.docker.findPanels('messages')[0];
      self.results_panel = self.docker.findPanels('results')[0];

      var editor_pane = $('<div id="stack_editor_pane" ' +
        'class="pg-panel-content info"></div>');
      var code_editor_area = $('<textarea id="profiler-editor-textarea">' +
        '</textarea>').appendTo(editor_pane);
      self.code_editor_panel.layout().addItem(editor_pane);

      // To show the line-number and set breakpoint marker details by user.
      self.editor = CodeMirror.fromTextArea(
        code_editor_area.get(0), {
          tabindex: -1,
          lineNumbers: true,
          foldOptions: {
            widget: '\u2026',
          },
          foldGutter: {
            rangeFinder: CodeMirror.fold.combine(
              CodeMirror.pgadminBeginRangeFinder,
              CodeMirror.pgadminIfRangeFinder,
              CodeMirror.pgadminLoopRangeFinder,
              CodeMirror.pgadminCaseRangeFinder
            ),
          },
          gutters: [
            'CodeMirror-linenumbers', 'CodeMirror-foldgutter', 'breakpoints',
          ],
          mode: 'text/x-pgsql',
          readOnly: true,
          extraKeys: pgAdmin.Browser.editor_shortcut_keys,
          indentWithTabs: pgAdmin.Browser.editor_options.indent_with_tabs,
          indentUnit: pgAdmin.Browser.editor_options.tabSize,
          tabSize: pgAdmin.Browser.editor_options.tabSize,
          lineWrapping: pgAdmin.Browser.editor_options.wrapCode,
          autoCloseBrackets: pgAdmin.Browser.editor_options.insert_pair_brackets,
          matchBrackets: pgAdmin.Browser.editor_options.brace_matching,
        });

      // Useful for keyboard navigation, when user presses escape key we will
      // defocus from the codemirror editor allow user to navigate further
      CodeMirror.on(self.editor, 'keydown', function(cm,event) {
        if(event.keyCode==27){
          document.activeElement.blur();
        }
      });

      pgBrowser.Events.on('pgadmin:profiler:code:focus', ()=>{
        self.editor.focus();
      });

      // On loading the docker, register the callbacks
      var onLoad = function() {
        self.docker.finishLoading(100);
        self.docker.off(wcDocker.EVENT.LOADED);
        /* Set focus to the profiler container
         * Focus does not work in firefox without tabindex attr
         * so, setting focus to parent of $container which is #container
         */
        if(self.docker.$container){
          self.docker.$container.parent().focus();
        }

        let cacheIntervalId = setInterval(function() {
          try {
            let browser = window.opener ? window.opener.pgAdmin.Browser : window.top.pgAdmin.Browser;
            if(browser.preference_version() > 0) {
              clearInterval(cacheIntervalId);
              self.reflectPreferences();

              /* If profiler is in a new tab, event fired is not available
               * instead, a poller is set up who will check
               */
              if(self.preferences.profiler_new_browser_tab) {
                let pollIntervalId = setInterval(()=>{
                  if(window.opener && window.opener.pgAdmin) {
                    self.reflectPreferences();
                  }
                  else {
                    clearInterval(pollIntervalId);
                  }
                }, 1000);
              }
            }
          }
          catch(err) {
            clearInterval(cacheIntervalId);
            throw err;
          }
        },0);

      };

      self.docker.startLoading(gettext('Loading...'));
      self.docker.on(wcDocker.EVENT.LOADED, onLoad);

      // Create the toolbar view for profiling the function
      this.toolbarView = new ProfilerToolbarView();

      /* wcDocker focuses on window always, and all our shortcuts are
       * bind to editor-panel. So when we use wcDocker focus, editor-panel
       * loses focus and events don't work.
       */
      $(window).on('keydown', (e)=>{
        if(self.toolbarView.keyAction) {
          self.toolbarView.keyAction(e);
        }
      });

      /* Cache may take time to load for the first time
       * Keep trying till available
       */


      /* Register for preference changed event broadcasted in parent
       * to reload the shorcuts.
       */
      pgBrowser.onPreferencesChange('profiler', function() {
        self.reflectPreferences();
      });
    },
    reflectPreferences: function() {
      let self = this,
        browser = window.opener ? window.opener.pgAdmin.Browser : window.top.pgAdmin.Browser;
      self.preferences = browser.get_preferences_for_module('profiler');
      self.toolbarView.preferences = self.preferences;

      /* TODO: Update the shortcuts of the buttons */
      /* Update the shortcuts of the buttons */
      self.toolbarView.$el.find('#btn-start')
        .attr('title', keyboardShortcuts.shortcut_accesskey_title('Start',self.preferences.btn_step_into))
        .attr('accesskey', keyboardShortcuts.shortcut_key(self.preferences.start));

      self.toolbarView.$el.find('#btn-stop')
        .attr('title', keyboardShortcuts.shortcut_accesskey_title('Stop',self.preferences.btn_step_over))
        .attr('accesskey', keyboardShortcuts.shortcut_key(self.preferences.stop));

      self.toolbarView.$el.find('#btn-save')
        .attr('title', keyboardShortcuts.shortcut_accesskey_title('Save',self.preferences.btn_start))
        .attr('accesskey', keyboardShortcuts.shortcut_key(self.preferences.save));

    },
    // Register the panel with new profiler docker instance.
    registerPanel: function(name, title, width, height, onInit) {
      var self = this;

      this.docker.registerPanelType(name, {
        title: title,
        isPrivate: true,
        onCreate: function(panel) {
          self.panels[name] = panel;
          panel.initSize(width, height);
          if (!title)
            panel.title(false);
          else
            panel.title(title);
          panel.closeable(false);
          panel.layout().addItem(
            $('<div tabindex="0">', {
              'class': 'pg-profiler-panel',
            })
          );
          if (onInit) {
            onInit.apply(self, [panel]);
          }
        },
      });
    },
  });

  pgTools.DirectProfile = new DirectProfile();
  pgTools.DirectProfile['jquery'] = $;

  return pgTools.DirectProfile;
});
