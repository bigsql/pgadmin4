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
  'pgadmin.tools.profiler.report', 'sources/keyboard_shortcuts',
  'pgadmin.tools.profiler.utils',  'wcdocker',
], function(
  gettext, url_for, $, _, Alertify, pgAdmin, pgBrowser, Backbone, Backgrid,
  Backform, codemirror, input_report_options,
) {

  const CodeMirror = codemirror.default,
    wcDocker = window.wcDocker;

  if(pgAdmin.Browser.tree != null) {
    pgAdmin = pgAdmin || window.pgAdmin || {};
  }

  const pgTools = pgAdmin.Tools = pgAdmin.Tools || {};

  if(pgTools.Profile) {
    return pgTools.Profile;
  }

  /**
   * Primary event handler that will interact with the wcDocker instance
   *
   */
  const controller = new(function() {});

  _.extend(
    controller, Backbone.Events, {
      /**
       * Trigger the event and change the button view to enable/disable
       * the buttons for profiling
       */
      enable: function(btn, enable) {
        this.trigger('pgProfiler:button:state:' + btn, enable);
      },

      enable_toolbar_buttons: function() {
        const self = this;
        self.enable('start', true);
        self.enable('report-options', true);
      },

      disable_toolbar_buttons: function() {
        const self = this;
        self.enable('start', false);
        self.disable('report-options', false);
      },

      /**
       * Sends a message to the server to start direct profiling, then if
       * successful, updates the results, updates the reports, and updates
       * the current report preview panel
       *
       * @param {int} trans_id The unique transaction id for the already
       *                       initialized profiling instance
       */
      start_execution: function(trans_id) {
        $.ajax({
          url        : url_for('profiler.start_execution', { 'trans_id': trans_id }),
          method     : 'GET',
          beforeSend : (xhr) => {
            xhr.setRequestHeader(pgAdmin.csrf_token_header, pgAdmin.csrf_token);
            $('.profiler-container').addClass('show_progress');
          },
        })
          .done(function(res) {
            $('.profiler-container').removeClass('show_progress');

            if(res.data.status === 'Success') {
              controller.addResults(res.data.col_info, res.data.result);
              controller._add_new_report(res.data.report_headers);
            }
            else if(res.data.status === 'NotConnected') {
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
       * Sends a message to the server to start indirect profiling, then
       * if successful, updates the reports, and opens the newly created
       * report in a new tab
       *
       * @param {int} trans_id The unique transaction id for the already
       *                       initialize profiling instance
       */
      start_monitor : function(trans_id) {
        // Get duration through AJAX call to display to user
        $.ajax({
          url    : url_for('profiler.get_parameters', { 'trans_id': trans_id }),
          method : 'GET',
        })
          .done(function(res) {
            if(res.data.status === 'Success') {

              let duration = parseInt(res.data.result[0].value, 10);

              // Make ajax call to start monitoring
              $.ajax({
                url        : url_for('profiler.start_monitor', { 'trans_id': trans_id }),
                method     : 'POST',
                beforeSend : (xhr) => {
                  xhr.setRequestHeader(pgAdmin.csrf_token_header, pgAdmin.csrf_token);
                  pgTools.Profile.docker.startLoading(
                    gettext(`Monitoring for ${duration} seconds`)
                  );

                  // We decrease the duration by 1 because time will already
                  // have passed by the time the loading wheel is created and
                  // shown. Note that the timer is not synced up with the server.
                  // The server will still profile for the correct amount of
                  // time even though the client interface may not reflect it.
                  controller._update_monitor_load(duration - 1);
                },
              })
                .done(function(res) {
                  pgTools.Profile.docker.finishLoading();

                  if(res.data.status === 'Success') {
                    controller._add_new_report(res.data.report_headers);

                  }
                  else if(res.data.status === 'NotConnected') {
                    Alertify.alert(
                      gettext('Profiler Error'),
                      gettext('Not Connected.')
                    );
                  } else if (res.data.status === 'ERROR') {
                    Alertify.alert(
                      gettext('Profiler Error'),
                      gettext(res.data.result)
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
            }
            else if(res.data.status == 'Not Connected') {
              Alertify.alert(
                gettext('Profiler Error'),
                gettext('Not Connected.')
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

      /**
       * Updates the results panel for the profiling window
       *
       * @param {Array} columns Contains the names of the columns for the results panel
       * @param {Array} result  Contains the values of the columns for the results panel
       */
      addResults : function(columns, result) {

        // Remove the existing created grid and update the result values
        if(self.result_grid) {
          this.result_grid.remove();
          this.result_grid = null;
        }

        // Collection which contains the model for results
        const ResultsCollection = Backbone.Collection.extend({
          model : Backbone.Model.extend({
            defaults : {
              name : void 0,
            },
          }),
        });

        const resultGridCols = [];
        if(_.size(columns)) {
          _.each(columns, function(c) {
            const column = {
              type     : 'text',
              editable : false,
              cell     : 'string',
            };
            column.name = column.label = c.name;
            resultGridCols.push(column);
          });
        }

        // Initialize a new Grid instance
        const result_grid = this.result_grid = new Backgrid.Grid({
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
      update_parameters: function() {
        $.ajax({
          url    : url_for('profiler.get_parameters', { 'trans_id': pgTools.Profile.trans_id }),
          method : 'GET',
        })
          .done(function(res) {
            if(res.data.status === 'Success') {

              // Add the parameters to the panel
              controller.addParameters(res.data.result);
            }

            else if(res.data.status === 'NotConnected') {
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
       * Adds the retrieved parameters from the server to the panel.
       * Also initializes the grid that contains the parameters
       *
       * @param {Array} result The JSON containing information about the parameters
       */
      addParameters: function(result) {

        // Remove the existing created grid and update the parameter values
        if(this.param_grid) {
          this.param_grid.remove();
          this.param_grid = null;
        }

        // Collection which contains the model for function informations.
        const ParametersCollection =
          this.ParametersCollection = Backbone.Collection.extend({
            model: Backbone.Model.extend({
              defaults: {
                name  : void 0,
                type  : void 0,
                value : void 0,
              },
            }),
          });

        const paramGridCols = [{
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

        const param_obj = [];
        if(result.length != 0) {
          for(let i = 0; i < result.length; i = i + 1) {
            param_obj.push({
              'name'  : result[i].name,
              'type'  : result[i].type,
              'value' : result[i].value,
            });
          }
        }

        // Initialize a new Grid instance
        const param_grid = this.param_grid = new Backgrid.Grid({
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
       * Retrieves the saved reports from the server then adds them to the saved reports panel
       *
       */
      update_reports: function() {
        $.ajax({
          url    : url_for('profiler.get_reports'),
          async  : false,
          method : 'GET',
        })
          .done(function(res) {
            if(res.data.status === 'Success') {
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
       * Adds the retrieved reports from the server to the panel by
       * initializing the reports grid. Also defines functionality
       * for the buttons on the grid and logic for keyboard navigation
       *
       * @param {Array} result - The JSON containing information about the reports
       */
      addReports: function(result) {
        const self = this;

        // Remove the existing created grid and update the result values
        if(self.reports_grid) {
          self.reports_grid.remove();
          self.reports_grid = null;
        }

        // Collection which contains the model for report informations.
        const ReportsCollection =
          self.ReportsCollection = Backbone.Collection.extend({
            model: Backbone.Model.extend({
              defaults : {
                profile_type : void 0,
                database     : void 0,
                time         : void 0,
                duration     : void 0,
                report_id    : void 0,
              },
            }),
          });

        const reportsGridCols = [
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
            label       : gettext('Start Date | Time'),
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
            // Custom button cell to add functionality
            // when the show report button is clicked
            cell       : Backgrid.Cell.extend({
              className : 'report-cell',
              events : {
                'click button' : 'generateReport',
              },
              generateReport : function(e) {
                e.preventDefault();
                e.stopPropagation();

                const report_url = url_for(
                  'profiler.show_report', {
                    'report_id': this.model.get('report_id'),
                  });
                window.open(report_url, '_blank');
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
            cell       :
              Backgrid.Cell.extend({
                className : 'delete-cell',
                events : {
                  'click button' : 'deleteReport',
                },

                deleteReport : function(e) {
                  const temp = this;

                  e.preventDefault();
                  e.stopPropagation();

                  Alertify.confirm(
                    'Delete',
                    'Would you like to delete the selected report?',
                    function() {
                      const report_url = url_for(
                        'profiler.delete_report', {
                          'report_id' : temp.model.get('report_id'),
                        });

                      $.ajax({
                        url    : report_url,
                        method : 'POST',
                      })
                        .done(function(res) {
                          if(res.data.status == 'ERROR') {
                            Alertify.alert(
                              gettext('Profiler Error'),
                              gettext('Error in deleting selected report'));
                          }

                          // Remove the selected row from the collection and therefore the grid
                          pgTools.Profile.reportsColl.remove(temp.model);
                          pgTools.Profile.numReports = pgTools.Profile.numReports - 1;

                          // The last (and only remaining report) is deleted
                          if (pgTools.Profile.numReports == 0) {

                            // clear the container
                            const current_reports = pgTools.Profile.current_report_panel;
                            current_reports.$container.find('.current_report').html('');
                          } else {

                            // Case of deleting the report for the row at the bottom of the grid
                            if(pgTools.Profile.currentReportIndex === pgTools.Profile.numReports) {
                              pgTools.Profile.currentReportIndex -= 1;
                            }

                            // show the next row
                            controller._load_report(pgTools.Profile.currentReportIndex);
                          }
                        });

                    },
                    null
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
        const reports_obj = [];
        if(result.length != 0) {
          pgTools.Profile.numReports = result.length;
          for(let i = 0; i < result.length; i = i + 1) {
            reports_obj.push({
              'profile_type': result[i].profile_type === true ? result[i].name : 'Global',
              'database'    : result[i].database,
              'start_date'  : result[i].time,
              'duration'    : `${result[i].duration} seconds`,
              'report_id'   : result[i].report_id,
            });
          }
        }

        self.reportsCollection = new ReportsCollection(reports_obj);

        // Initialize a new Grid instance
        const reports_grid = this.reports_grid = new Backgrid.Grid({
          emptyText  : 'No data found',
          columns    : reportsGridCols,
          row        : Backgrid.Row.extend({
            highlightColor : 'lightYellow',
            className      : 'selectable-row',
            events         : { 'click': 'onClick' },
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
            const report_url = url_for(
              'profiler.show_report', {
                'report_id': m.model.get('report_id'),
              });
            $.ajax({
              url    : report_url,
              method : 'GET',
            })
              .done(function(res) {
                pgTools.Profile.currentId  = m.model.get('report_id');

                // We use a shadow DOM to encapsulate the report's css and javascript
                // Note that the shadow DOM cannot use the JS of the page because we load the
                // report data by setting innerHTML. Thus, we extract the scripts by hand and
                // add them manually
                let container = document.createElement('div');
                container.attachShadow({mode: 'open'});
                container.shadowRoot.innerHTML = res;

                const current_reports = pgTools.Profile.current_report_panel;

                current_reports.$container.find('.current_report').html('');
                current_reports.$container.find('.current_report').append(container);

                current_reports.focus();
              })
              .fail(function() {
                Alertify.alert(
                  gettext('Profiler error'),
                  gettext('Error while getting report data.')
                );
              });

            // Update the current_report_index
            for(let i = 0; i < pgTools.Profile.reportsColl.models.length; i = i + 1) {
              const current = pgTools.Profile.reportsColl.models[i];

              if(current.cid === m.model.cid){
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
          for(let i = 0; i < pgTools.Profile.reportsColl.models.length; i = i + 1) {
            const current = pgTools.Profile.reportsColl.models[i];

            if(pgTools.Profile.currentId === current.get('report_id')) {
              pgTools.Profile.currentReportIndex = i;

              // we have found the desired index so no need to continue
              break;
            }
          }

          controller._load_report(pgTools.Profile.currentReportIndex);
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
        controller._load_report(pgTools.Profile.currentReportIndex);
      },

      /**
       * Formats and adds new report data to the Reports grid
       *
       * @param {Object} An object that contains report information about the newly generated
       *                 report
       */
      _add_new_report : function(report_data) {

        // format the report headers and add new report to grid
        pgTools.Profile.reportsColl.add({
          'profile_type': report_data.profile_type === true ? report_data.name : 'Global',
          'database'    : report_data.database,
          'start_date'  : report_data.time,
          'duration'    : `${report_data.duration} seconds`,
          'report_id'   : report_data.report_id,
        });

        pgTools.Profile.numReports = pgTools.Profile.numReports + 1;
        pgTools.Profile.currentId = report_data.report_id;

        // Default the currently showed report to the first report in the grid and show it
        pgTools.Profile.currentReportIndex = 0;
        controller._load_report(pgTools.Profile.currentReportIndex);
      },

      /**
       * Helper function that finds the rowClick event that corersponds to the row we want to show
       * then the function will trigger the event and load the report
       *
       * @param {int} reportIndex - The index of the row containing the report we want to show
       */
      _load_report : function(reportIndex) {

        // Make sure that there is a report to show
        if(pgTools.Profile.reportsColl.models.length > 0) {

          let e = void 0;
          const currentReportId =
            pgTools.Profile.reportsColl.models[reportIndex].get('report_id');

          // get the correct event to pass into backgrid trigger
          $.each(pgTools.Profile.reports_grid.columns._listeners, function(k, v) {

            if(v.listener.model) {
              if(currentReportId == v.listener.model.get('report_id')) {
                e = v.listener;
              }
            }
          });

          if(e === void 0 ) {
            console.warn('No rowClick event found for the given report index');
          }
          else {
            // Finally, load the report
            Backbone.trigger('rowClicked', e);
          }
        }
      },

      /**
       * Helper function that generates the loading wheel for indirect(global) profiling and
       * counts down, updating the wheel
       *
       * @param {int} duration - The original duration of the monitoring
       */
      _update_monitor_load : function(duration) {

        // Queue up the setTimeouts so they display properly. Note that if the duration is
        // too long, then too many setTimeout Objects may be created, causing a slowdown on page
        for(let i = duration; i > 0; i--) {
          ((time) => {
            setTimeout(
              () => {
                $('.wcLoadingLabel').html(gettext(`Monitoring for ${time} seconds`));
              },
              (duration - i + 1) * 1000);
          })(i);
        }
      },
    },
  );

  /*
   * Profiler tool var view to create the button toolbar and listen to the button
   * click event and inform the controller about the click and controller will
   * take the action for the specified button click.
   */
  const ProfilerToolbarView = Backbone.View.extend({
    el: '.profiler_main_container',
    initialize: function() {
      controller.on('pgProfiler:button:state:start', this.enable_start, this);
      controller.on('pgProfiler:button:state:report-options' , this.enable_report_options, this);
    },
    events: {
      'click .btn-start'          : 'on_start',
      'click .btn-report-options' : 'on_report_options',
      'keydown'                   : 'keyAction',
    },
    enable_start: function(enable) {
      const $btn = this.$el.find('.btn-start');

      if(enable) {
        $btn.prop('disabled', false);
        $btn.removeAttr('disabled');
      }
      else {
        $btn.prop('disabled', true);
        $btn.attr('disabled', 'disabled');
      }
    },
    enable_report_options: function(enable) {
      const $btn = this.$el.find('.btn-report-options');

      if(enable) {
        $btn.prop('disabled', false);
        $btn.removeAttr('disabled');
      }
      else {
        $btn.prop('disabled', true);
        $btn.attr('disabled', 'disabled');
      }
    },
    on_start: function(e) {
      e.stopPropagation();
      e.preventDefault();

      if(pgTools.Profile.profile_type == 1) {
        controller.start_execution(pgTools.Profile.trans_id);
      }
      else {
        controller.start_monitor(pgTools.Profile.trans_id);
      }
    },
    on_report_options: function(e) {
      e.stopPropagation();
      e.preventDefault();

      input_report_options(pgTools.Profile.trans_id);
    },
    keyAction: function(e) {
      e.stopPropagation();

      const key = `${e.code}`;

      if(key === 'ArrowUp' || key === 'ArrowDown') {
        const change = (key === 'ArrowUp') ? -1 : 1;
        const new_index = pgTools.Profile.currentReportIndex + change;

        if(new_index >= 0 && new_index < pgTools.Profile.numReports) {
          pgTools.Profile.currentReportIndex = new_index;
          controller._load_report(pgTools.Profile.currentReportIndex);
        }
      }
    },
  });


  /*
   * Function is responsible to create the new wcDocker instance for profiler and
   * initialize the profiler panel inside the docker instance.
   */
  const Profile = function() {};

  _.extend(Profile.prototype, {
    /**
     * Sets up the wcDocker instance for the profiler, intializes the panels, and loads server
     * data to display to the user
     *
     * @param {int} trans_id     the unique transaction id for the current profiling session
     * @param {int} profile_type flag to determine if profiling is indirect(0) or direct(1)
     * @param {String} function_name_with_arguments the name of the function we wish to profile
     *                 note that this should be 'indirect' in indirect profiling instances
     * @param {Object} layout the layout of the panels in the window to be loaded
     */
    load: function(trans_id, profile_type, function_name_with_arguments, layout) {

      const self = this;

      // We do not want to initialize the module multiple times.
      if(this._initialized) {
        return;
      }
      this._initialized = true;

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

      const browser =
        window.opener ? window.opener.pgAdmin.Browser : window.top.pgAdmin.Browser;
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
      controller.update_reports();

      // Note that for direct profiling this will be the parameters
      // For indirect(global) profiling, this will be the profiling arguments
      controller.update_parameters();

      // Direct profiling requires fetching sql source code
      if(trans_id != void 0 && profile_type) {

        // Get source code to display in code editor panel
        $.ajax({
          url    : url_for('profiler.get_src', { 'trans_id' : trans_id }),
          method : 'GET',
        })
          .done(function(res) {
            if(res.data.status === 'Success') {
              pgTools.Profile.editor.setValue(res.data.result);
            }

            else if(res.data.status === 'NotConnected') {
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

    /**
     * Creates the default panel layout. This will be code editorpanel
     * at the top, with the current report panel stacked next to it.
     * Then the parameters panel at the bottom, with the results and saved
     * reports panels stacked on top of it.
     *
     * @param {Object} docker The instance of the wcDocker that panels will be added to
     */
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

    /**
     * Creates the profiler layout with splitter and display the appropriate data
     * received from server.
     */
    initializePanels: function() {
      let self = this;
      this.registerPanel(
        'code', self.function_name_with_arguments, '100%', '50%',
        function() {

          // Create the parameters panel to display the arguments of the functions
          const parameters = new pgAdmin.Browser.Panel({
            name        : 'parameters',
            title       : gettext('Parameters'),
            width       : '100%',
            height      : '100%',
            isCloseable : false,
            isPrivate   : true,
            content     : '<div id ="parameters" class="parameters" tabindex="0"></div>',
          });

          // Create the result panel to display the result after profiling the function
          const results = new pgAdmin.Browser.Panel({
            name        : 'results',
            title       : gettext('Results'),
            width       : '100%',
            height      : '100%',
            isCloseable : false,
            isPrivate   : true,
            content     : '<div id="profile_results" class="profile_results" tabindex="0"></div>',
          });

          // Create the reports panel to display saved profiling reports
          const reports = new pgAdmin.Browser.Panel({
            name        : 'reports',
            title       : gettext('Profiling Reports'),
            width       : '100%',
            height      : '100%',
            isCloseable : false,
            isPrivate   : true,
            content     : '<div id ="reports" class="reports" tabindex="0"></div>',
          });

          const current_report = new pgAdmin.Browser.Panel({
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

      const editor_pane = $('<div id="stack_editor_pane" ' +
        'class="pg-panel-content info"></div>');
      const code_editor_area = $('<textarea id="profiler-editor-textarea">' +
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
      const onLoad = function() {
        self.docker.finishLoading(100);
        self.docker.off(wcDocker.EVENT.LOADED);
        /* Set focus to the profiler container
         * Focus does not work in firefox without tabindex attr
         * so, setting focus to parent of $container which is #container
         */
        if(self.docker.$container){
          self.docker.$container.parent().focus();
        }

        const preference_logger = () => {
          setTimeout(() => {
            try {
              const browser =
                window.opener ? window.opener.pgAdmin.Browser : window.top.pgAdmin.Browser;
              if(browser.preference_version() > 0) {
                self.reflectPreferences();

                /* If profiler is in a new tab, event fired is not available
                 * instead, a poller is set up who will check
                 */
                if(self.preferences.profiler_new_browser_tab) {
                  const poller = ()=> {
                    setTimeout(() => {
                      if(window.opener && window.opener.pgAdmin) {
                        self.reflectPreferences();
                        poller();
                      }
                    }, 1000);
                  };

                  poller();
                }
              }
              preference_logger();
            }
            catch(err) {
              throw err;
            }
          }, 0);
        };

        preference_logger();
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
      pgBrowser.onPreferencesChange('profiler', () => { self.reflectPreferences(); });

      self.editor.focus();
    },

    start_execution : function(trans_id) {
      controller.start_execution(trans_id);
    },

    /**
     * Retrieve preferences for the profiler
     */
    reflectPreferences: function() {
      const self = this,
        browser = window.opener ? window.opener.pgAdmin.Browser : window.top.pgAdmin.Browser;
      self.preferences = browser.get_preferences_for_module('profiler');
      self.toolbarView.preferences = self.preferences;
    },

    /**
     * Register the panel with the given parameters to the wcDocker instance
     *
     * @param {String} name  name of the panel
     * @param {String} title title of th panel to be displayed to the User
     * @param {int} width    width of the panel (%)
     * @param {int} height   height of the panel (%)
     * @param {function} onInit function to be called on initialization
     */
    registerPanel: function(name, title, width, height, onInit) {
      const self = this;

      this.docker.registerPanelType(name, {
        title: title,
        isPrivate: true,
        onCreate: function(panel) {
          self.panels[name] = panel;
          panel.initSize(width, height);
          if(!title)
            panel.title(false);
          else
            panel.title(title);
          panel.closeable(false);
          panel.layout().addItem(
            $('<div tabindex="0">', {
              'class': 'pg-profiler-panel',
            })
          );
          if(onInit) {
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
