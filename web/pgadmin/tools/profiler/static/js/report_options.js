/////////////////////////////////////////////////////////////
//
//
//
//
//
/////////////////////////////////////////////////////////////

define([
  'sources/gettext', 'sources/url_for', 'jquery', 'underscore', 'backbone',
  'pgadmin.alertifyjs', 'sources/pgadmin', 'pgadmin.browser',
  'pgadmin.backgrid',
], function(
  gettext, url_for, $, _, Backbone, Alertify, pgAdmin, pgBrowser, Backgrid
) {

  var ProfilerReportOptionsModel = Backbone.Model.extend({
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
  var ProfilerReportOptionsCollections = Backbone.Collection.extend({
    model: ProfilerReportOptionsModel,
  });

  var res = function(trans_id, function_name_with_arguments, profiler_new_browser_tab) {
    if (!Alertify.profilerReportOptionsDialog) {
      Alertify.dialog('profilerReportOptionsDialog', function factory() {
        return {
          main: function(title, trans_id, function_name_with_arguments, profiler_new_browser_tab) {
            this.preferences = pgBrowser.get_preferences_for_module('profiler');
            this.set('title', title);

            // setting value in alertify settings allows us to access it from
            // other functions other than main function.
            this.set('trans_id', trans_id);
            this.set('profiler_new_browser_tab', profiler_new_browser_tab);
            this.set('function_name_with_arguments', function_name_with_arguments);

            var option_header = Backgrid.HeaderCell.extend({
              // Add fixed width to the "option" column
              className: 'width_percent_15',
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

            var my_obj = [];
            my_obj.push({
              'option' : 'Name',
              'value'  : function_name_with_arguments,
            }, {
              'option' : 'Title',
              'value'  : 'Pl/Profiler Report for ' + function_name_with_arguments,
            }, {
              'option' : 'Tabstop',
              'value'  : '8',
            }, {
              'option' : 'SVG Width',
              'value'  : '1200',
            }, {
              'option' : 'Table Width',
              'value'  : '80%',
            }, {
              'option' : 'Description',
              'value'  : '',
            }, );

            this.ProfilerReportOptionsColl =
                new ProfilerReportOptionsCollections(my_obj);

            // Initialize a new Grid instance
            if (this.grid) {
              this.grid.remove();
              this.grid = null;
            }
            var grid = this.grid = new Backgrid.Grid({
              columns: gridCols,
              collection: this.ProfilerReportOptionsColl,
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
            trans_id: undefined,
            profiler_new_browser_tab: undefined,
            function_name_with_arguments: undefined,
          },
          setup: function() {
            return {
              buttons: [{
                text: gettext('Cancel'),
                key: 27,
                className: 'btn btn-secondary fa fa-times pg-alertify-button',
              },{
                text: gettext('Submit'),
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
            if (e.button.text === gettext('Submit')) {
              // Initialize the target once the debug button is clicked and
              // create asynchronous connection and unique transaction ID
              var self = this;

              var options_value_list = [];

              this.grid.collection.each(function(m) {
                options_value_list.push({
                  'option': m.get('option'),
                  'value': m.get('value'),
                });
              });

              var baseUrl = url_for('profiler.set_config', {
                'trans_id' : self.setting('trans_id'),
              });

              $.ajax({
                url: baseUrl,
                method: 'POST',
                data: {
                  'data': JSON.stringify(options_value_list),
                },
              })
                .done(function(res) {
                  if (res.data.status == 'ERROR') {
                    Alertify.alert(gettext(res.data.result));
                  }

                })
                .fail(function() {
                  Alertify.alert(
                    gettext('Profiler Error'),
                    gettext('Error while fetching reports.')
                  );
                });


              return true;
            }

            if (e.button.text === gettext('Cancel')) {
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
            this.grid.listenTo(this.profilerReportOptionsColl, 'backgrid:edited',
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

            this.grid.listenTo(this.profilerReportOptionsColl, 'backgrid:error',
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

    Alertify.profilerReportOptionsDialog(
      gettext('Report Options'), trans_id, function_name_with_arguments, profiler_new_browser_tab
    ).resizeTo(pgBrowser.stdW.md,pgBrowser.stdH.md);
  };

  return res;
});
