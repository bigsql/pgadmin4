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

  const ProfilerReportOptionsModel = Backbone.Model.extend({
    defaults: {
      option: undefined,
      value: undefined,
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
  const ProfilerReportOptionsCollections = Backbone.Collection.extend({
    model: ProfilerReportOptionsModel,
  });

  const res = function(trans_id) {
    if (!Alertify.profilerReportOptionsDialog) {
      Alertify.dialog('profilerReportOptionsDialog', function factory() {
        return {
          main: function(title, trans_id) {
            this.preferences = pgBrowser.get_preferences_for_module('profiler');
            this.set('title', title);

            if (this.initialized){
              return;
            }

            this.initialized = true;

            // setting value in alertify settings allows us to access it from
            // other functions other than main function.
            this.set('trans_id', trans_id);

            const gridCols = [
              {
                name       : 'option',
                label      : gettext('Option'),
                type       : 'text',
                editable   : false,
                cell       : 'string',
                headerCell :
                  Backgrid.HeaderCell.extend({
                    className: 'width_percent_15',
                  }),
              },
              {
                name  : 'value',
                label : gettext('Value'),
                type  : 'text',
                cell  : 'string',
              },
            ];

            const self = this;

            $.ajax({
              url    : url_for('profiler.get_config', { 'trans_id': trans_id }),
              method : 'GET',
              async  : false,
            })
              .done(function(res) {
                if (res.data.status == 'Success') {
                  const param_obj = [];
                  if (res.data.result.length != 0) {
                    for (let i = 0; i < res.data.result.length; i++) {
                      param_obj.push({
                        'option' : res.data.result[i].option,
                        'value'  : res.data.result[i].value,
                      });
                    }
                  }

                  self.ProfilerReportOptionsColl =
                      new ProfilerReportOptionsCollections(param_obj);

                  // Initialize a new Grid instance
                  if (self.grid) {
                    self.grid.remove();
                    self.grid = null;
                  }
                  const grid = self.grid = new Backgrid.Grid({
                    columns    : gridCols,
                    collection : new ProfilerReportOptionsCollections(param_obj),
                    className  : 'backgrid table table-bordered table-noouter-border table-bottom-border',
                  });

                  grid.render();
                  $(self.elements.content).html(grid.el);
                }
              })
              .fail(function() {
                Alertify.alert(
                  gettext('Profiler Error'),
                  gettext('Could not fetch report options from server'));
              });
          },
          settings: {
            trans_id: undefined,
            function_name_with_arguments: undefined,
          },
          setup: function() {
            return {
              buttons: [{
                text      : gettext('Cancel'),
                key       : 27,
                className : 'btn btn-secondary fa fa-times pg-alertify-button',
              },{
                text      : gettext('Submit'),
                key       : 13,
                className : 'btn btn-primary fa fa-bullseye pg-alertify-button', // TODO: replace icon
              }],
              // Set options for dialog
              options: {
                //disable both padding and overflow control.
                padding          : !1,
                overflow         : !1,
                model            : 0,
                resizable        : true,
                maximizable      : true,
                pinnable         : false,
                closableByDimmer : false,
                modal            : false,
              },
            };
          },
          // Callback functions when click on the buttons of the Alertify dialogs
          callback: function(e) {
            if (e.button.text === gettext('Submit')) {
              // Initialize the target once the debug button is clicked and
              // create asynchronous connection and unique transaction ID
              const self = this;

              const options_value_list = [];

              self.grid.collection.each(function(m) {
                options_value_list.push({
                  'option' : m.get('option'),
                  'value'  : m.get('value'),
                });
              });

              $.ajax({
                url    : url_for('profiler.set_config', { 'trans_id' : self.setting('trans_id') }),
                method : 'POST',
                data   : {
                  'data': JSON.stringify(options_value_list),
                },
              })
                .done(function(res) {
                  if (res.data.status == 'ERROR') {
                    Alertify.alert(gettext(res.data.result));
                  }

                  if (res.data.status == 'Success') {
                    Alertify.success('Succesfully saved report options', 3);
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
                  let enable_btn = false;
                  for (let i = 0; i < this.collection.length; i++) {
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
      gettext('Report Options'), trans_id
    ).resizeTo(pgBrowser.stdW.md,pgBrowser.stdH.md);
  };

  return res;
});
