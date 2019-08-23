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
  'pgadmin.backgrid', 'wcdocker',
], function(
  gettext, url_for, $, _, Backbone, Alertify, pgAdmin, pgBrowser, Backgrid
) {

  const wcDocker = window.wcDocker;

  const ProfilerInputOptionsModel = Backbone.Model.extend({
    defaults: {
      option: undefined,
      value: undefined,
    },
    validate: function() {
      if (_.isUndefined(this.get('value'))
        || _.isNull(this.get('value'))
        || String(this.get('value')).replace(/^\s+|\s+$/g, '') == '')
      {
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
  const ProfilerInputOptionsCollections = Backbone.Collection.extend({
    model: ProfilerInputOptionsModel,
  });

  const res = function(profile_info, trans_id) {
    if (!Alertify.profilerInputOptionsDialog) {
      Alertify.dialog('profilerInputOptionsDialog', function factory() {
        return {
          /**
           * Sets up the Alertify dialog box by creating the grid and input areas
           *
           * @param {String} title        The title to display in the Alertify dialog box
           * @param {Object} profile_info Information about the profile(In this case the server Id and db Id)
           * @param {int} trans_id        The unique transaction id that was created for this profiling session
           */
          main: function(title, profile_info, trans_id) {
            this.preferences = window.top.pgAdmin.Browser.get_preferences_for_module('profiler');
            this.set('title', title);

            // setting value in alertify settings allows us to access it from
            // other functions other than main function.
            this.set('profile_info', profile_info);
            this.set('trans_id', trans_id);

            const my_obj = [];
            my_obj.push({
              'option' : 'Duration (sec)',
              'value'  : void 0,
            }, {
              'option' : 'Interval (sec)',
              'value'  : void 0,
            },
            {
              'option' : 'PID (Optional)',
              'value'  : void 0,
            },);


            const gridCols = [{
              name: 'option',
              label: gettext('Option'),
              type: 'text',
              editable: false,
              cell: 'string',
              headerCell: Backgrid.HeaderCell.extend({
                // Add fixed width to the "option" column
                className: 'width_percent_25',
              }),
            },
            {
              name: 'value',
              label: gettext('Value'),
              type: 'text',
              editable: true,
              cell: Backgrid.IntegerCell,
            },
            ];

            this.ProfilerInputOptionsColl =
                new ProfilerInputOptionsCollections(my_obj);

            // Initialize a new Grid instance
            if (this.grid) {
              this.grid.remove();
              this.grid = null;
            }
            const grid = this.grid = new Backgrid.Grid({
              columns: gridCols,
              collection: this.ProfilerInputOptionsColl,
              className: 'backgrid table table-bordered table-noouter-border table-bottom-border',
            });

            grid.render();
            $(this.elements.content).html(grid.el);

          },
          settings: {
            profile_info: undefined,
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
                className: 'btn btn-primary fa fa-bullseye pg-alertify-button',
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
           * indirect(global) profiling instance
           *
           * @param {Object} e the event object that was fired
           *
           * @returns {boolean} true if the 'Profile' button was selected and server correctly
           *                    created a profiling instance
           */
          callback: function(e) {
            if (e.button.text === gettext('Profile')) {
              // Initialize the target once the debug button is clicked and
              // create asynchronous connection and unique transaction ID
              let self = this;

              const options_value_list = [];

              this.grid.collection.each(function(m) {
                options_value_list.push({
                  'option': m.get('option'),
                  'value': m.get('value'),
                });
              });

              const baseUrl = url_for('profiler.initialize_target_indirect', {
                'trans_id' : self.setting('trans_id'),
                'sid' : self.setting('profile_info').sid,
                'did' : self.setting('profile_info').did,
              });

              $.ajax({
                url: baseUrl,
                method: 'POST',
                data: {
                  'data': JSON.stringify(options_value_list),
                },
              })
                .done(function(res) {
                  const url = url_for(
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

                    let dashboardPanel = pgBrowser.docker.findPanels('properties'),
                      panel = pgBrowser.docker.addPanel(
                        'frm_profiler', wcDocker.DOCK.STACKED, dashboardPanel[0]
                      );

                    panel.focus();

                    // Panel Closed event
                    panel.on(wcDocker.EVENT.CLOSED, function() {
                      const closeUrl = url_for('profiler.close', {
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
                  let enable_btn = false;

                  for (let i = 0; i < this.collection.length; i++) {

                    if (this.collection.models[i].get('value') == null ||
                        this.collection.models[i].get('value') == void 0) {
                      enable_btn = true;
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
      gettext('Global Profiling Options'), profile_info, trans_id
    ).resizeTo(pgBrowser.stdW.md,pgBrowser.stdH.md);
  };

  return res;
});
