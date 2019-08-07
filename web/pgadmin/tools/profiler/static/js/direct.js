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
        self.enable('save' , true);
      },

      disable_toolbar_buttons: function() {
        var self = this;
        self.enable('start', false);
        self.enable('save' , false);
      },

      // Function to profile for direct profiling
      start_execution: function(trans_id) {
        var self = this;

        // Make ajax call to listen the database message
        var baseUrl = url_for(
          'profiler.start_execution', {
            'trans_id': trans_id,
            'port_num': 1000,
          });
        $.ajax({
          url: baseUrl,
          method: 'GET',
        })
          .done(function(res) {
            if (res.data.status === 'Success') {
              self.AddResults(res.data.col_info, res.data.result);

              // Update saved reports
              var reportsUrl = url_for('profiler.get_reports');
              $.ajax({
                url: reportsUrl,
                method: 'GET',
              })
                .done(function(res) {
                  if (res.data.status === 'Success') {
                    controller.AddReports(res.data.result);
                  }
                })
                .fail(function() {
                  Alertify.alert(
                    gettext('Profiler Error'),
                    gettext('Error while fetching reports.')
                  );
                });
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

      /*
        For the direct profiling, we need to check weather the functions execution
        is completed or not. After completion of the profiling, we will stop polling
        the result  until new execution starts.
      */
      poll_end_execution_result: function(trans_id) {
        console.warn(trans_id);
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

        /*
         * During the execution we should poll the result in minimum seconds
         * but once the execution is completed and wait for the another
         * profiling session then we should decrease the polling frequency.
         */
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
                  */

                    pgTools.DirectProfile.direct_execution_completed = true;
                    pgTools.DirectProfile.polling_timeout_idle = true;

                    //Set the alertify message to inform the user that execution is completed.
                    Alertify.success(res.info, 3);

                    // Execution completed so disable the buttons other than
                    // "Continue/Start" button because user can still
                    // start the same execution again.
                    setTimeout(function() {
                      self.enable('start', false);
                      self.enable('save', false);
                    }, 500);

                    // Stop further polling
                    pgTools.DirectProfile.is_polling_required = false;
                  } else {
                  // Call function to create and update local variables ....
                    if (res.data.result != null) {
                      self.AddResults(res.data.col_info, res.data.result);
                      pgTools.DirectProfile.results_panel.focus();
                      pgTools.DirectProfile.direct_execution_completed = true;
                      pgTools.DirectProfile.polling_timeout_idle = true;

                      //Set the alertify message to inform the user that execution is completed.
                      Alertify.success(res.info, 3);

                      // Execution completed so disable the buttons other than
                      // "Continue/Start" button because user can still
                      // start the same execution again.
                      setTimeout(function() {
                        self.enable('start', false);
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

                } else if (res.data.status === 'NotConnected') {
                  Alertify.alert(
                    gettext('Profiler poll end execution error'),
                    res.data.result
                  );
                } else if (res.data.status === 'ERROR') {
                  pgTools.DirectProfile.direct_execution_completed = true;

                  //Set the Alertify message to inform the user that execution is
                  // completed with error.
                  if (!pgTools.DirectProfile.is_user_aborted_profiling) {
                    Alertify.error(res.info, 3);
                  }

                  // Execution completed so disable the buttons other than
                  // "Continue/Start" button because user can still start the
                  // same execution again.
                  self.enable('start', false);
                  self.enable('save', false);

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
          editable: false,
          cell: 'string',
        },
        ];

        var param_obj = [];
        if (result.length != 0) {
          for (var i = 0; i < result.length; i++) {
            param_obj.push({
              'name': result[i].name,
              'type': result[i].type,
              'value': result[i].value,
            });
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
      AddSrc: function(result) {
        pgTools.DirectProfile.editor.setValue(result);
      },
      AddReports: function(result) {
        var self = this;

        // Remove the existing created grid and update the result values
        if (self.reports_grid) {
          self.reports_grid.remove();
          self.reports_grid = null;
        }

        var ProfilerReportsModel = Backbone.Model.extend({
          defaults: {
            name: undefined,
            profile_type: undefined,
            database: undefined,
            time: undefined,
            report_id: undefined,
          },
        });

        // Collection which contains the model for report informations.
        var ReportsCollection = self.ReportsCollection = Backbone.Collection.extend({
          model: ProfilerReportsModel,
        });

        // TODO: implement delete functionality
        //ReportsCollection.prototype.on(
        //  'change', self.deposit_parameter_value, self
        //);

        var buttonCell = Backgrid.Cell.extend({
          events: {
            'click button' : 'generateReport',
          },

          generateReport: function() {
            var reportUrl = url_for(
              'profiler.show_report', {
                'report_id': this.model.get('report_id'),
              });

            window.open(reportUrl, '_blank');
          },

          render: function() {
            this.$el.html('<button> Show </button>');
            return this;
          },

        });

        var reportsGridCols = [{
          name: 'name',
          label: gettext('Name'),
          type: 'text',
          editable: false,
          cell: 'string',
        },
        {
          name: 'profile_type',
          label: gettext('Profile Type'),
          type: 'text',
          editable: false,
          cell: 'string',
        },
        {
          name: 'database',
          label: gettext('Database'),
          type: 'text',
          editable: false,
          cell: 'string',
        },
        {
          name: 'time',
          label: gettext('Date/Time'),
          type: 'text',
          editable: false,
          cell: 'string',
        },
        {
          name: 'report_id',
          label: gettext('Show Report'),
          type: 'text',
          editable: false,
          cell: buttonCell,
        },
        ];

        var reports_obj = [];
        if (result.length != 0) {
          for (var i = 0; i < result.length; i++) {
            reports_obj.push({
              'name': result[i].name,
              'profile_type': (result[i].profile_type === true ? 'Direct' : 'Indirect'),
              'database': result[i].database,
              'time': result[i].time,
              'report_id': result[i].report_id,
            });
          }
        }

        // Initialize a new Grid instance
        var reports_grid = this.reports_grid = new Backgrid.Grid({
          emptyText: 'No data found',
          columns: reportsGridCols,
          collection: new ReportsCollection(reports_obj),
          className: 'backgrid table table-bordered table-noouter-border table-bottom-border',
        });

        reports_grid.render();

        // Render the result grid into result panel
        pgTools.DirectProfile.reports_panel
          .$container
          .find('.reports')
          .append(reports_grid.el);
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
      controller.on('pgProfiler:button:state:save' , this.enable_save, this);
    },
    events: {
      'click .btn-start': 'on_start',
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
      controller.start_execution(pgTools.DirectProfile.trans_id);
    },
    on_save: function() {
      controller.save(pgTools.DirectProfile.trans_id);
    },
    keyAction: function (event) {
      console.warn(event);
      /*
      let panel_type='';

      panel_type = keyboardShortcuts.processEventProfiler(
        this.$el, event, this.preferences, pgTools.DirectProfile.docker
      );


      if(!_.isNull(panel_type) && !_.isUndefined(panel_type) && panel_type != '') {
        setTimeout(function() {
          pgBrowser.Events.trigger(`pgadmin:profiler:${panel_type}:focus`);
        }, 100);
      }*/
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

      // We do not want to initialize the module multiple times.
      var self = this;

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
      } else if (trans_id != undefined && profile_type) { // Direct profiling
        self.initializePanels();
        controller.enable_toolbar_buttons();

        // Get parameters
        var paramUrl = url_for('profiler.get_parameters', {
          'trans_id': trans_id,
        });
        $.ajax({
          url: paramUrl,
          method: 'GET',
        })
          .done(function(res) {
            if (res.data.status === 'Success') {
              controller.AddParameters(res.data.result);
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

        // Get source code
        var srcUrl = url_for('profiler.get_src', {
          'trans_id' : trans_id,
        });
        $.ajax({
          url: srcUrl,
          method: 'GET',
        })
          .done(function(res) {
            if (res.data.status === 'Success') {
              controller.AddSrc(res.data.result);
            }

            else if (res.data.status === 'NotConnected') {
              Alertify.alert(
                gettext('Profiler Error'),
                gettext('Error whiel fetching parameters.')
              );
            }
          })
          .fail(function() {
            Alertify.alert(
              gettext('Profiler Error'),
              gettext('Error while fetching sql source code.')
            );
          });

        // Get reports
        var reportsUrl = url_for('profiler.get_reports');
        $.ajax({
          url: reportsUrl,
          method: 'GET',
        })
          .done(function(res) {
            if (res.data.status === 'Success') {
              controller.AddReports(res.data.result);
            }
          })
          .fail(function() {
            Alertify.alert(
              gettext('Profiler Error'),
              gettext('Error while fetching reports.')
            );
          });
      } else {
        this.initializePanels();
      }
    },


    buildDefaultLayout: function(docker) {
      let code_editor_panel = docker.addPanel('code', wcDocker.DOCK.TOP);

      let parameters_panel = docker.addPanel('parameters', wcDocker.DOCK.BOTTOM, code_editor_panel);
      docker.addPanel('results',wcDocker.DOCK.STACKED, parameters_panel, {
        tabOrientation: wcDocker.TAB.TOP,
      });
      docker.addPanel('reports', wcDocker.DOCK.STACKED, parameters_panel);
      docker.addPanel('report_options', wcDocker.DOCK.STACKED, parameters_panel);
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

          // Create the reports panel to display saved profiling reports
          var reports = new pgAdmin.Browser.Panel({
            name: 'reports',
            title: gettext('Profiling Reports'),
            width: '100%',
            height: '100%',
            isCloseable: false,
            isPrivate: true,
            content: '<div id ="reports" class="reports" tabindex="0"></div>',
          });

          // Create the reports panel to display saved report options
          var report_options = new pgAdmin.Browser.Panel({
            name: 'report_options',
            title: gettext('Report Options'),
            width: '100%',
            height: '100%',
            isCloseable: false,
            isPrivate: true,
            content: '<div id ="report_options" class="report_options" tabindex="0"></div>',
          });

          // Load all the created panels
          parameters.load(self.docker);
          results.load(self.docker);
          reports.load(self.docker);
          report_options.load(self.docker);
        });

      // restore the layout if present else fallback to buildDefaultLayout
      pgBrowser.restore_layout(self.docker, self.layout, this.buildDefaultLayout.bind(this));

      self.docker.on(wcDocker.EVENT.LAYOUT_CHANGED, function() {
        pgBrowser.save_current_layout('Profiler/Layout', self.docker);
      });

      self.code_editor_panel = self.docker.findPanels('code')[0];
      self.parameters_panel = self.docker.findPanels('parameters')[0];
      self.results_panel = self.docker.findPanels('results')[0];
      self.reports_panel = self.docker.findPanels('reports')[0];
      self.report_options = self.docker.findPanels('report_options')[0];

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

  pgTools.DirectProfile = new DirectProfile();
  pgTools.DirectProfile['jquery'] = $;

  return pgTools.DirectProfile;
});
