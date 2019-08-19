/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
//
//////////////////////////////////////////////////////////////

define([
  'sources/gettext', 'sources/url_for', 'jquery', 'underscore',
  'pgadmin.alertifyjs', 'sources/pgadmin', 'pgadmin.browser', 'backbone',
  'pgadmin.backgrid', 'pgadmin.backform', 'sources/../bundle/codemirror',
  'pgadmin.tools.profiler.ui', 'pgadmin.tools.profiler.options', 'pgadmin.tools.profiler.report',
  'sources/keyboard_shortcuts', 'pgadmin.tools.profiler.utils',  'wcdocker',
], function(
  gettext, url_for, $, _, Alertify, pgAdmin, pgBrowser, Backbone, Backgrid,
  Backform, codemirror, profile_function_again, monitor_function_again, input_report_options,
) {

  var CodeMirror = codemirror.default,
    wcDocker = window.wcDocker;

  if (pgAdmin.Browser.tree != null) {
    pgAdmin = pgAdmin || window.pgAdmin || {};
  }

  var pgTools = pgAdmin.Tools = pgAdmin.Tools || {};

  if (pgTools.Profile)
    return pgTools.Profile;

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
        self.enable('save' , true);
        self.enable('report-options', true);
      },

      disable_toolbar_buttons: function() {
        var self = this;
        self.enable('start', false);
        self.enable('save' , false);
        self.disable('report-options', false);
      },

      /**
       * Sends a message to the server to start direct profiling, then if successful, updates the
       * results, updates the reports, and opens the newly created report in a new tab
       *
       * @param {int} trans_id - The unique transaction id for the already initialize profiling
       *  instance
       */
      startExecution: function(trans_id) {

        // Make ajax call to run profiler
        var baseUrl = url_for(
          'profiler.start_execution', {
            'trans_id': trans_id,
          });
        $.ajax({
          url        : baseUrl,
          method     : 'GET',
          beforeSend : function(xhr) {
            xhr.setRequestHeader(pgAdmin.csrf_token_header, pgAdmin.csrf_token);
            $('.profiler-container').addClass('show_progress');
          },
        })
          .done(function(res) {
            $('.profiler-container').removeClass('show_progress');

            if (res.data.status === 'Success') {
              pgTools.Profile.profile_completed = true;
              controller.addResults(res.data.col_info, res.data.result);
              controller.fetchAndAddReports();
            } else if (res.data.status === 'NotConnected') {
              Alertify.alert(
                gettext('Profiler Error'),
                gettext('Error while starting profiling.')
              );
            }
          })
          .fail(function() {
            $('.profiler-container').removeClass('show_progress');
            Alertify.alert(
              gettext('Profiler Error'),
              gettext('Error while starting profiling.')
            );
          });
      },

      /**
       * Helper function that generates the loading wheel for indirect(global) profiling and
       * counts down, updating the wheel
       *
       * @param {int} duration - The original duration of the monitoring
       */
      updateMonitorLoad : function(duration) {
        var time_remaining = duration * 1000;

        var intervalId = setInterval(function() {
          $('.wcLoadingLabel').html(gettext('Monitoring for ' + time_remaining/1000 + ' seconds'));
          time_remaining -= 1000;
          if (time_remaining < 0) {

            // kill the timer to prevent waste
            clearInterval(intervalId);
          }
        }, 1000);
      },

      /**
       * Sends a message to the server to start indirect profiling, then if successful,
       * updates the reports, and opens the newly created report in a new tab
       *
       * @param {int} trans_id - The unique transaction id for the already initialize profiling
       *  instance
       */
      startMonitor : function(trans_id) {
        var self = this;

        // Get duration through AJAX call to display to user
        var getDurationUrl = url_for('profiler.get_duration', { 'trans_id': trans_id });
        $.ajax({
          url    : getDurationUrl,
          method : 'GET',
        })
          .done(function(res) {
            if (res.data.status === 'Success') {
              var duration = parseInt(res.data.duration, 10);

              // Make ajax call to start monitoring
              var baseUrl = url_for('profiler.start_monitor', { 'trans_id': trans_id });
              $.ajax({
                url        : baseUrl,
                method     : 'GET',
                beforeSend : function(xhr) {
                  xhr.setRequestHeader(pgAdmin.csrf_token_header, pgAdmin.csrf_token);
                  pgTools.Profile.docker.startLoading(gettext('Monitoring for ' + duration + ' seconds'));

                  // We decrease the duration by 1 because time will already have passed by the
                  // time the loading wheel is created and shown
                  controller.updateMonitorLoad(duration - 1);
                },
              })
                .done(function(res) {
                  pgTools.Profile.profile_completed = true;
                  pgTools.Profile.docker.finishLoading();

                  if (res.data.status === 'Success') {
                    self.addResults(res.data.col_info, res.data.result);

                    // Update saved reports
                    controller.fetchAndAddReports();

                  } else if (res.data.status === 'NotConnected') {
                    Alertify.alert(
                      gettext('Profiler Error'),
                      gettext('Error when starting monitoring.')
                    );
                  }
                })
                .fail(function() {
                  pgTools.Profile.docker.finishLoading();
                  $('.profiler-container').removeClass('show_progress');

                  Alertify.alert(
                    gettext('Profiler Error'),
                    gettext('Error while monitoring.')
                  );
                });
            } else if (res.data.status == 'Not Connected') {
              Alertify.alert(
                gettext('Profiler Error'),
                gettext('Could not connect to the server.')
              );
            }

          })
          .fail(function() {
            Alertify.alert(
              gettext('Profiler Error'),
              gettext('Error while getting duration.')
            );
          });
      },

      restart : function(trans_id) {
        //var self = this,
        var restartUrl = url_for('profiler.restart', {'trans_id' : trans_id});

        $.ajax({
          url : restartUrl,
        })
          .done(function(res) {
            if (res.data.profile_data.profile_type === 'direct') {
              if (res.data.require_input) {

                var result = _.extend({}, res.data.profile_data, res.data.func_data);

                result['proargtypenames'] = result['args_type'];
                result['proargnames']     = result['args_name'];
                result['proargmodes']     = result['arg_mode'];

                profile_function_again(result, 1, pgTools.Profile.trans_id);
              } else {
                controller.startExecution(pgTools.Profile.trans_id);
              }
            } else {
              monitor_function_again(pgTools.Profile.trans_id);
            }

          })
          .fail(function(xhr) {
            try {
              var err = JSON.parse(xhr.responseText);
              if (err.success == 0) {
                Alertify.alert(gettext('Debugger Error'), err.errormsg);
              }
            } catch (e) {
              console.warn(e.stack || e);
            }
          });
      },

      /**
       * Updates the results panel for the profiling window
       *
       * @param {Array} columns - Contains the names of the columns for the results panel
       * @param {Array} result - Contains the values of the columns for the results panel
       */
      addResults : function(columns, result) {
        var self = this;

        // Remove the existing created grid and update the result values
        if (self.result_grid) {
          self.result_grid.remove();
          self.result_grid = null;
        }

        // Collection which contains the model for function informations.
        var ResultsCollection = Backbone.Collection.extend({
          model : Backbone.Model.extend({
            defaults : {
              name : undefined,
            },
          }),
        });

        var resultGridCols = [];
        if (_.size(columns)) {
          _.each(columns, function(c) {
            var column = {
              type     : 'text',
              editable : false,
              cell     : 'string',
            };
            column['name'] = column['label'] = c.name;
            resultGridCols.push(column);
          });
        }

        // Initialize a new Grid instance
        var result_grid = this.result_grid = new Backgrid.Grid({
          emptyText  : 'No data found',
          columns    : resultGridCols,
          collection : new ResultsCollection(result),
          className  : 'backgrid table table-bordered table-noouter-border table-bottom-border',
        });

        result_grid.render();

        // Render the result grid into result panel
        pgTools.Profile.results_panel
          .$container
          .find('.profile_results')
          .append(result_grid.el);
      },

      /**
       * Retrieves the parameters from the server then adds them to the parameters panel
       *
       */
      fetchParameters: function() {
        var paramUrl = url_for('profiler.get_parameters', { 'trans_id': pgTools.Profile.trans_id });
        $.ajax({
          url    : paramUrl,
          method : 'GET',
        })
          .done(function(res) {
            if (res.data.status === 'Success') {

              // Add the parameters to the panel
              controller.addParameters(res.data.result);
            }

            else if (res.data.status === 'NotConnected') {
              Alertify.alert(
                gettext('Profiler Error'),
                gettext('Error while fetching parameters.')
              );
            }
          })
          .fail(function() {
            Alertify.alert(
              gettext('Profiler Error'),
              gettext('Error while fetching parameters.')
            );
          });
      },

      /**
       * Adds the retrieved parameters from the server to the panel. Also initializes the grid
       * that contains the parameters
       *
       * @param {Array} result - The JSON containing information about the parameters
       */
      addParameters: function(result) {
        var self = this;

        // Remove the existing created grid and update the parameter values
        if (self.param_grid) {
          self.param_grid.remove();
          self.param_grid = null;
        }

        // Collection which contains the model for function informations.
        var ParametersCollection = self.ParametersCollection = Backbone.Collection.extend({
          model: Backbone.Model.extend({
            defaults: {
              name  : undefined,
              type  : undefined,
              value : undefined,
            },
          }),
        });

        var paramGridCols = [{
          name     : 'name',
          label    : gettext('Name'),
          type     : 'text',
          editable : false,
          cell     : 'string',
        },
        {
          name     : 'type',
          label    : gettext('Type'),
          type     : 'text',
          editable : false,
          cell     : 'string',
        },
        {
          name     : 'value',
          label    : gettext('Value'),
          type     : 'text',
          editable : false,
          cell     : 'string',
        },
        ];

        var param_obj = [];
        if (result.length != 0) {
          for (var i = 0; i < result.length; i++) {
            param_obj.push({
              'name'  : result[i].name,
              'type'  : result[i].type,
              'value' : result[i].value,
            });
          }
        }

        // Initialize a new Grid instance
        var param_grid = this.param_grid = new Backgrid.Grid({
          emptyText  : 'No data found',
          columns    : paramGridCols,
          collection : new ParametersCollection(param_obj),
          className  : 'backgrid table table-bordered table-noouter-border table-bottom-border',
        });

        param_grid.render();

        // Render the parameters grid into parameter panel
        pgTools.Profile.parameters_panel
          .$container
          .find('.parameters')
          .append(param_grid.el);
      },

      /**
       * Adds the source code for the function to be profiled into the code editor panel
       *
       * @param {Array} result - The JSON containing information about the source code
       */
      addSrc: function(result) {
        pgTools.Profile.editor.setValue(result);
      },

      /**
       * Retrieves the saved reports from the server then adds them to the saved reports panel
       *
       */
      fetchAndAddReports: function() {
        var reportsUrl = url_for('profiler.get_reports');
        $.ajax({
          url    : reportsUrl,
          async  : false,
          method : 'GET',
        })
          .done(function(res) {
            if (res.data.status === 'Success') {
              controller.addReports(res.data.result);
            }
          })
          .fail(function() {
            Alertify.alert(
              gettext('Profiler Error'),
              gettext('Error while fetching reports.')
            );
          });
      },

      /**
       * Adds the retrieved reports from the server to the panel by initializing the reports grid.
       * Also defines functionality for the buttons on the grid and logic for keyboard navigation
       *
       * @param {Array} result - The JSON containing information about the reports
       */
      addReports: function(result) {
        var self = this;

        // Remove the existing created grid and update the result values
        if (self.reports_grid) {
          self.reports_grid.remove();
          self.reports_grid = null;
        }

        // Collection which contains the model for report informations.
        var ReportsCollection = self.ReportsCollection = Backbone.Collection.extend({
          model: Backbone.Model.extend({
            defaults : {
              profile_type : undefined,
              database     : undefined,
              time         : undefined,
              duration     : undefined,
              report_id    : undefined,
            },
          }),
        });

        var reportsGridCols = [
          {
            name       : 'profile_type',
            label      : gettext('Profile Type / Function Name'),
            type       : 'text',
            editable   : false,
            headerCell :
              Backgrid.HeaderCell.extend({
                className : 'width_percent_30',
              }),
            cell       : 'string',
          },
          {
            name       : 'database',
            label      : gettext('Database Name'),
            type       : 'text',
            editable   : false,
            headerCell :
              Backgrid.HeaderCell.extend({
                className : 'width_percent_20',
              }),
            cell       : 'string',
          },
          {
            name        : 'start_date',
            label       : gettext('Start Date/Time'),
            type        : 'text',
            editable    : false,
            headerCell  :
              Backgrid.HeaderCell.extend({
                className  : 'width_percent_15',
              }),
            cell        : 'string',
          },
          {
            name       : 'duration',
            label      : gettext('Duration'),
            type       : 'text',
            headerCell :
              Backgrid.HeaderCell.extend({
                className : 'width_percent_15',
              }),
            editable: false,
            cell       : 'string',
          },
          {
            name       : 'report_id',
            label      : gettext('Show Report'),
            type       : 'text',
            editable   : false,
            headerCell :
              Backgrid.HeaderCell.extend({
                className : 'width_percent_10',
              }),
            // Custom button cell to add functionality when the show report button is clicked
            cell       : Backgrid.Cell.extend({
              className : 'report-cell',
              events : {
                'click button' : 'generateReport',
              },
              generateReport : function(e) {
                e.preventDefault();
                e.stopPropagation();

                var reportUrl = url_for(
                  'profiler.show_report', {
                    'report_id': this.model.get('report_id'),
                  });
                window.open(reportUrl, '_blank');
              },
              render : function() {
                this.$el.html('<button> Show </button>');
                return this;
              },
            }),
          },
          {
            name       : 'delete',
            label      : gettext('Delete Report'),
            type       : 'text',
            editable   : false,
            headerCell :
              Backgrid.HeaderCell.extend({
                className : 'width_percent_10',
              }),
            // Custom button cell to add functionality when the delete report button is clicked
            cell       :
              Backgrid.Cell.extend({
                className : 'delete-cell',
                events : {
                  'click button' : 'deleteReport',
                },

                deleteReport : function(e) {
                  // need to save this because of Alertify call handler/scope
                  var temp = this;

                  e.preventDefault();
                  e.stopPropagation();

                  // Create a confirm alert
                  Alertify.confirm(
                    'Delete',
                    'Would you like to delete the selected report?',

                    // On confirmation send AJAX request to server to delete
                    // and delete from client interface
                    function() {
                      var reportUrl = url_for(
                        'profiler.delete_report', {
                          'report_id' : temp.model.get('report_id'),
                        });

                      $.ajax({
                        url    : reportUrl,
                        method : 'POST',
                      })
                        .done(function(res) {
                          if (res.data.status == 'ERROR') {
                            Alertify.alert(
                              gettext('Profiler Error'),
                              gettext('Error in deleting selected report'));
                          }

                          // Remove the selected row from the collection and therefore the grid
                          pgTools.Profile.reportsColl.remove(temp.model);
                          pgTools.Profile.numReports -= 1;

                          // Case of deleting the report for the row at the bottom of the grid
                          if (pgTools.Profile.currentReportIndex === pgTools.Profile.numReports) {
                            pgTools.Profile.currentReportIndex -= 1;
                          }

                          // Note that since the selected report is deleted, we choose to show the
                          // report at the same row. The rows immediately below the deleted row
                          // should be shown
                          controller.loadReport(pgTools.Profile.currentReportIndex);
                        });

                    },

                    // If the user decides not to delete, there is nothing to do
                    function() {}
                  );
                },

                render : function() {
                  this.$el.html('<button> Delete </button>');
                  return this;
                },
              }),
          },
        ];

        // Now format the information fetched from the server for rendering the grid
        var reports_obj = [];
        if (result.length != 0) {
          pgTools.Profile.numReports = result.length;
          for (var i = 0; i < result.length; i++) {
            reports_obj.push({
              'profile_type': result[i].profile_type === true ? result[i].name : 'Global',
              'database'    : result[i].database,
              'start_date'  : result[i].time,
              'duration'    : result[i].duration === -1 ? 'n/a' : result[i].duration + ' seconds',
              'report_id'   : result[i].report_id,
            });
          }
        }

        self.reportsCollection = new ReportsCollection(reports_obj);

        // Initialize a new Grid instance
        var reports_grid = this.reports_grid = new Backgrid.Grid({
          emptyText  : 'No data found',
          columns    : reportsGridCols,
          // Custom row that will allow users to click
          row        : Backgrid.Row.extend({
            highlightColor : 'lightYellow',
            className      : 'selectable-row',
            events         : {'click': 'onClick'},
            onClick        :
              function (e) {
                e.stopPropagation();
                Backbone.trigger('rowClicked', this);
              },
          }),
          collection : self.reportsCollection,
          className  : 'backgrid table table-bordered table-noouter-border table-bottom-border',
        });

        // Display the most newly created reports first
        reports_grid.render().sort('start_date', 'descending');

        // Event handler for rowclick Event
        this.listenTo(Backbone,'rowClicked',
          function(m) {
            // Highlight the selected report
            self.reports_grid.$el.find('td').css(
              'background-color', ''
            );
            m.$el.find('td').css('background-color', m.highlightColor);

            // Generate the report html
            var reportUrl = url_for(
              'profiler.show_report', {
                'report_id': m.model.get('report_id'),
              });
            $.ajax({
              url    : reportUrl,
              method : 'GET',
            })
              .done(function(res) {
                pgTools.Profile.currentId  = m.model.get('report_id');

                // We use a shadow DOM to encapsulate the report's css and javascript
                // Note that the shadow DOM cannot use the JS of the page because we load the
                // report data by setting innerHTML. Thus, we extract the scripts by hand and
                // add them manually

                // At this point, although the scripts can be correctly added, they do not function
                // as intended because of encapsulation between the DOM and shadow DOM.

                // TODO: Fix Styling
                var scripts = [];
                var styleSheets = [];

                var resHTML = res.split(' ');

                var scriptSave = false;
                var styleSave  = false;

                var currentScript = '';
                var currentStyle  = '';
                for (var i = 0; i < resHTML.length; i++) {
                  current = resHTML[i].trim();

                  if (current === '<script') {
                    scriptSave = true;
                    i++;  // Skip 1 because of 'language = x'
                    continue;
                  }
                  if (current === '</script>') {
                    scriptSave = false;
                    scripts.push(currentScript);
                    currentScript = '';
                    continue;
                  }
                  if (scriptSave) currentScript += ' ' + resHTML[i];

                  if (current === '<style>') {
                    styleSave = true;
                    continue;
                  } else if (current === '<style') {
                    styleSave = true;
                    i++;
                    continue;
                  }
                  if (current === '</style>') {
                    styleSave = false;
                    styleSheets.push(currentStyle);
                    currentStyle = '';
                    continue;
                  }
                  if (styleSave) currentStyle += ' ' + resHTML[i];
                }

                let container = document.createElement('div');
                container.attachShadow({mode: 'open'});
                container.shadowRoot.innerHTML = res;

                _.map(scripts, function(s) {
                  var script = document.createElement('script');
                  script.textContent = s;
                  container.shadowRoot.appendChild(script);
                });

                _.map(styleSheets, function(s) {
                  var styleSheet = document.createElement('style');
                  styleSheet.innerText = s;
                  container.shadowRoot.appendChild(styleSheet);
                });

                pgTools.Profile.current_report_panel.$container.find('.current_report').html('');
                pgTools.Profile.current_report_panel.$container.find('.current_report').append(container);

                pgTools.Profile.current_report_panel.focus();
              })
              .fail(function() {
                Alertify.alert(
                  gettext('Profiler error'),
                  gettext('Error while getting report data.')
                );
              });

            // Update the current_report_index
            for (var i = 0; i < pgTools.Profile.reportsColl.models.length; i++) {
              var current = pgTools.Profile.reportsColl.models[i];

              if (current.cid === m.model.cid){
                pgTools.Profile.currentReportIndex = i;

                // we have found the desired index so no need to continue
                break;
              }

            }
          }
        );

        // When the grid is sorted, keep the index of the report we have already selected
        this.listenTo(self.reportsCollection, 'backgrid:sorted', function() {

          // Update the current_report_index
          for (var i = 0; i < pgTools.Profile.reportsColl.models.length; i++) {
            var current = pgTools.Profile.reportsColl.models[i];

            if (pgTools.Profile.currentId === current.get('report_id')) {
              pgTools.Profile.currentReportIndex = i;

              // we have found the desired index so no need to continue
              break;
            }
          }

          controller.loadReport(pgTools.Profile.currentReportIndex);
        });

        // Render the result grid into result panel
        pgTools.Profile.reports_panel
          .$container
          .find('.reports')
          .append(reports_grid.el);

        // Save the reports collection and reports grid, so we can use it for keyboard navigation
        pgTools.Profile.reportsColl  = self.reportsCollection;
        pgTools.Profile.reports_grid = reports_grid;

        // Default the currently showed report to the first report in the grid and show it
        pgTools.Profile.currentReportIndex = 0;
        controller.loadReport(pgTools.Profile.currentReportIndex);
      },

      /**
       * Helper function that finds the rowClick event that corersponds to the row we want to show
       * then the function will trigger the event and load the report
       *
       * @param {int} reportIndex - The index of the row containing the report we want to show
       */
      loadReport : function(reportIndex) {

        // Make sure that there is a report to show
        if (pgTools.Profile.reportsColl.models.length > 0) {

          var e, currentReportId =
            pgTools.Profile.reportsColl.models[reportIndex].get('report_id');

          // get the correct event to pass into backgrid trigger
          $.each(pgTools.Profile.reports_grid.columns._listeners, function(k, v) {

            if (v.listener.model) {
              if (currentReportId == v.listener.model.get('report_id')) {
                e = v.listener;
              }
            }
          });

          // Finally, load the first report
          Backbone.trigger('rowClicked', e);
        }
      },
    },
  );

  /*
    Profiler tool var view to create the button toolbar and listen to the button click event and inform the
    controller about the click and controller will take the action for the specified button click.
  */
  var ProfilerToolbarView = Backbone.View.extend({
    el: '.profiler_main_container',
    initialize: function() {
      controller.on('pgProfiler:button:state:start', this.enable_start, this);
      controller.on('pgProfiler:button:state:save' , this.enable_save, this);
      controller.on('pgProfiler:button:state:report-options' , this.enable_report_options, this);
    },
    events: {
      'click .btn-start'          : 'on_start',
      'click .btn-save'           : 'on_save',
      'click .btn-report-options' : 'on_report_options',
      'keydown'                   : 'keyAction',
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
    enable_report_options: function(enable) {
      var $btn = this.$el.find('.btn-report-options');

      if (enable) {
        $btn.prop('disabled', false);
        $btn.removeAttr('disabled');
      } else {
        $btn.prop('disabled', true);
        $btn.attr('disabled', 'disabled');
      }
    },
    on_start: function(e) {
      e.stopPropagation();

      // if (pgTools.Profile.profile_completed) {
      //   if (pgTools.Profile.profile_type == 1) {
      //     controller.restart(pgTools.Profile.trans_id);
      //   } else {
      //     //pass;
      //   }
      // }
      //
      // else {
      if (pgTools.Profile.profile_type == 1) {
        controller.startExecution(pgTools.Profile.trans_id);
      } else {
        controller.startMonitor(pgTools.Profile.trans_id);
      }
      //   }
      // }
    },
    on_report_options: function(e) {
      e.stopPropagation();
      input_report_options(pgTools.Profile.trans_id);
    },
    on_save: function(e) {
      e.stopPropagation();
      controller.save(pgTools.Profile.trans_id);
    },
    keyAction: function(e) {
      e.stopPropagation();

      var key = `${e.code}`;

      if (key === 'ArrowUp' || key === 'ArrowDown') {
        if (key === 'ArrowUp') {

          // Bounds checking
          if (pgTools.Profile.currentReportIndex > 0) {
            pgTools.Profile.currentReportIndex -= 1;
          }
        } else if (key === 'ArrowDown') {

          // Bounds checkings
          if (pgTools.Profile.currentReportIndex < pgTools.Profile.numReports - 1) {
            pgTools.Profile.currentReportIndex += 1;
          }
        }

        // Bounds checking
        if (pgTools.Profile.currentReportIndex >= 0 &&
            pgTools.Profile.currentReportIndex < pgTools.Profile.numReports) {

          controller.loadReport(pgTools.Profile.currentReportIndex);
        }
      }
    },
  });


  /*
    Function is responsible to create the new wcDocker instance for profiler and
    initialize the profiler panel inside the docker instance.
  */
  var Profile = function() {};

  _.extend(Profile.prototype, {
    /* We should get the transaction id from the server during initialization here */
    load: function(trans_id, profile_type, function_name_with_arguments, layout) {

      var self = this;

      // We do not want to initialize the module multiple times.
      if (this.initialized)
        return;
      this.initialized = true;

      this.profile_completed = false;

      this.trans_id                     = trans_id;
      this.profile_type                 = profile_type;
      this.function_name_with_arguments = function_name_with_arguments;

      this.layout = layout;

      // variables to save to support keyboard navigation
      this.reportsColl  = false;
      this.reports_grid = false;

      // number of reports to prevent out of bounds keyboard navigation
      this.numReports = 0;

      // index of currently selected report in the reports grid
      this.currentReportIndex = 0;

      // report_id of currently shown report in the current_reports_grid
      // we save this so when the grid is sorted, we show the same report and update the index
      this.currentId = -1;

      let browser = window.opener ?
        window.opener.pgAdmin.Browser : window.top.pgAdmin.Browser;
      this.preferences = browser.get_preferences_for_module('profiler');

      this.docker = new wcDocker(
        '#container', {
          allowContextMenu : false,
          allowCollapse    : false,
          loadingClass     : 'pg-sp-icon',
          themePath        : url_for( 'static', {'filename': 'css'} ),
          theme            : 'webcabin.overrides.css',
        });
      this.panels = [];

      pgBrowser.bind_beforeunload();

      self.initializePanels();

      controller.enable_toolbar_buttons();
      controller.fetchAndAddReports();
      // Note that for direct profiling this will be the parameters
      // For indirect(global) profiling, this will be the profiling arguments
      controller.fetchParameters();

      // Direct profiling requires fetching sql source code
      if (trans_id != undefined && profile_type) {
        // Get source code
        var srcUrl = url_for('profiler.get_src', {
          'trans_id' : trans_id,
        });
        $.ajax({
          url    : srcUrl,
          method : 'GET',
        })
          .done(function(res) {
            if (res.data.status === 'Success') {
              controller.addSrc(res.data.result);
            }

            else if (res.data.status === 'NotConnected') {
              Alertify.alert(
                gettext('Profiler Error'),
                gettext('Error while fetching parameters.')
              );
            }
          })
          .fail(function() {
            Alertify.alert(
              gettext('Profiler Error'),
              gettext('Error while fetching sql source code.')
            );
          });
      }
    },

    buildDefaultLayout: function(docker) {
      let code_editor_panel = docker.addPanel('code', wcDocker.DOCK.TOP);

      let parameters_panel = docker.addPanel('parameters', wcDocker.DOCK.BOTTOM, code_editor_panel);
      docker.addPanel('results',wcDocker.DOCK.STACKED, parameters_panel, {
        tabOrientation: wcDocker.TAB.TOP,
      });
      docker.addPanel('reports', wcDocker.DOCK.STACKED, parameters_panel);
      docker.addPanel('current_report', wcDocker.DOCK.STACKED, code_editor_panel, {
        tabOrientation: wcDocker.TAB.TOP,
      });
    },

    // Create the profiler layout with splitter and display the appropriate data received from server.
    initializePanels: function() {
      var self = this;
      this.registerPanel(
        'code', self.function_name_with_arguments, '100%', '50%',
        function() {

          // Create the parameters panel to display the arguments of the functions
          var parameters = new pgAdmin.Browser.Panel({
            name        : 'parameters',
            title       : gettext('Parameters'),
            width       : '100%',
            height      : '100%',
            isCloseable : false,
            isPrivate   : true,
            content     : '<div id ="parameters" class="parameters" tabindex="0"></div>',
          });

          // Create the result panel to display the result after profiling the function
          var results = new pgAdmin.Browser.Panel({
            name        : 'results',
            title       : gettext('Results'),
            width       : '100%',
            height      : '100%',
            isCloseable : false,
            isPrivate   : true,
            content     : '<div id="profile_results" class="profile_results" tabindex="0"></div>',
          });

          // Create the reports panel to display saved profiling reports
          var reports = new pgAdmin.Browser.Panel({
            name        : 'reports',
            title       : gettext('Profiling Reports'),
            width       : '100%',
            height      : '100%',
            isCloseable : false,
            isPrivate   : true,
            content     : '<div id ="reports" class="reports" tabindex="0"></div>',
          });

          var current_report = new pgAdmin.Browser.Panel({
            name        : 'current_report',
            title       : gettext('Current Report'),
            width       : '100%',
            height      : '100%',
            isCloseable : false,
            isPrivate   : true,
            content     : '<div id ="current_report" class="current_report" tabindex="0"></div>',
          });

          // Load all the created panels
          parameters.load(self.docker);
          results.load(self.docker);
          reports.load(self.docker);
          current_report.load(self.docker);
        });

      // restore the layout if present else fallback to buildDefaultLayout
      pgBrowser.restore_layout(self.docker, self.layout, this.buildDefaultLayout.bind(this));

      self.docker.on(wcDocker.EVENT.LAYOUT_CHANGED, function() {
        pgBrowser.save_current_layout('Profiler/Layout', self.docker);
      });

      self.code_editor_panel    = self.docker.findPanels('code')[0];
      self.parameters_panel     = self.docker.findPanels('parameters')[0];
      self.results_panel        = self.docker.findPanels('results')[0];
      self.reports_panel        = self.docker.findPanels('reports')[0];
      self.current_report_panel = self.docker.findPanels('current_report')[0];

      var editor_pane = $('<div id="stack_editor_pane" ' +
        'class="pg-panel-content info"></div>');
      var code_editor_area = $('<textarea id="profiler-editor-textarea">' +
        '</textarea>').appendTo(editor_pane);
      self.code_editor_panel.layout().addItem(editor_pane);

      // To show the line-number and set breakpoint marker details by user.
      self.editor = CodeMirror.fromTextArea(
        code_editor_area.get(0), {
          tabindex    : -1,
          lineNumbers : true,
          foldOptions : { widget: '\u2026' },
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
          mode              : 'text/x-pgsql',
          readOnly          : true,
          extraKeys         : pgAdmin.Browser.editor_shortcut_keys,
          indentWithTabs    : pgAdmin.Browser.editor_options.indent_with_tabs,
          indentUnit        : pgAdmin.Browser.editor_options.tabSize,
          tabSize           : pgAdmin.Browser.editor_options.tabSize,
          lineWrapping      : pgAdmin.Browser.editor_options.wrapCode,
          autoCloseBrackets : pgAdmin.Browser.editor_options.insert_pair_brackets,
          matchBrackets     : pgAdmin.Browser.editor_options.brace_matching,
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

      /* Register for preference changed event broadcasted in parent
       * to reload the shorcuts.
       */
      pgBrowser.onPreferencesChange('profiler', function() {
        self.reflectPreferences();
      });

      self.editor.focus();
    },

    startEx : function(trans_id) {
      controller.startExecution(trans_id);
    },
    reflectPreferences: function() {
      let self = this,
        browser = window.opener ? window.opener.pgAdmin.Browser : window.top.pgAdmin.Browser;
      self.preferences = browser.get_preferences_for_module('profiler');
      self.toolbarView.preferences = self.preferences;

      /* TODO: Update the shortcuts of the buttons */
      /* Update the shortcuts of the buttons */
      /*
      self.toolbarView.$el.find('#btn-start')
        .attr('title', keyboardShortcuts.shortcut_accesskey_title('Start',self.preferences.btn_step_into))
        .attr('accesskey', keyboardShortcuts.shortcut_key(self.preferences.start));


      self.toolbarView.$el.find('#btn-save')
        .attr('title', keyboardShortcuts.shortcut_accesskey_title('Save',self.preferences.btn_start))
        .attr('accesskey', keyboardShortcuts.shortcut_key(self.preferences.save));*/

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

  pgTools.Profile = new Profile();
  pgTools.Profile['jquery'] = $;

  return pgTools.Profile;
});
