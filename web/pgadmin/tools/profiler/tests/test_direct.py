import json

from flask_babelex import gettext

from regression import parent_node_dict
from regression.python_test_utils import test_utils as utils
from pgadmin.utils.route import BaseTestGenerator
from pgadmin.tools.profiler import DEFAULT_TABSTOP, DEFAULT_TABLE_WIDTH, \
                                   DEFAULT_SVG_WIDTH, DEFAULT_DESC

TEST_FUNC_NAME = 'test_sum_reg'
TEST_FUNC_BODY = 'RETURN a + b'
TEST_FUNC_ARGS = {'a': [2, 'integer'],
                  'b': [1, 'integer']}
TEST_FUNC_RESULT = 3
TEST_FUNC_SIGN = \
    '{0}({1})'.format(
        TEST_FUNC_NAME,
        ", ".join(['{0} {1}'.format(arg, TEST_FUNC_ARGS[arg][1]) for arg in TEST_FUNC_ARGS])
    )

TEST_REPORT_NAME = 'test_name'
TEST_REPORT_TABSTOP = 6
TEST_REPORT_SVG_WIDTH = 1000
TEST_REPORT_TABLE_WIDTH = '70%'
TEST_REPORT_DESCRIPTION = 'test'

class DirectProfilingTestCase(BaseTestGenerator):
    scenarios = [
        ('Testcase for direct profiling', {
            'urls': [
                '/profiler/init/function/{0}/{1}/{2}/{3}',
                '/profiler/initialize_target/{0}/{1}/{2}/{3}/{4}',
                '/profiler/profile/{0}',
                '/profiler/get_src/{0}',
                '/profiler/get_parameters/{0}',
                '/profiler/get_reports',
                '/profiler/get_config/{0}',
                '/profiler/set_config/{0}',
                '/profiler/start_execution/{0}',
                '/profiler/show_report/{0}',
                '/profiler/delete_report/{0}'
            ]
        })
    ]

    def setUp(self):
        super(DirectProfilingTestCase, self).setUp()
        self.config_data = utils.get_config_data()[0]
        self.conn = utils.get_db_connection(
            db=self.config_data['db'],
            username=self.config_data['username'],
            password=self.config_data['db_password'],
            host=self.config_data['host'],
            port=self.config_data['port'],
            sslmode=self.config_data['sslmode'])

        self.cursor = self.conn.cursor()
        self.cursor.execute(
                        "SELECT N.nspname "
                        "FROM pg_catalog.pg_extension E "
                        "JOIN pg_catalog.pg_namespace N ON N.oid = E.extnamespace "
                        "WHERE E.extname = \'plprofiler\'")
        self.schema_name = self.cursor.fetchone()[0]

        self.db_name = self.config_data['db']
        self.cursor.execute("SELECT db.oid from pg_database db "
                            "WHERE db.datname='%s'" % self.db_name)
        self.db_id = self.cursor.fetchone()[0]

        self.cursor.execute("SELECT N.oid "
                            "FROM pg_catalog.pg_namespace N "
                            "   JOIN pg_catalog.pg_extension E ON N.oid = E.extnamespace "
                            "WHERE E.extname = 'plprofiler'")
        try:
            self.schema_id = self.cursor.fetchone()[0]
        except Exception as e:
            self.skipTest('Could not find schema with plprofiler extension installed '
                          '(Please verify config settings are correct)')
        schid = str(self.schema_id)

        try:
            self.cursor.execute(
                "CREATE OR REPLACE FUNCTION {0} RETURNS integer AS $$"
                "   BEGIN "
                "       {1}; "
                "   END; "
                "$$   LANGUAGE plpgsql; ".format(TEST_FUNC_SIGN, TEST_FUNC_BODY)
            )
        except Exception as e:
            self.skipTest('Could not create test function')

        self.cursor.execute("SELECT p.oid "
                            "FROM pg_catalog.pg_proc P "
                            "   LEFT JOIN pg_catalog.pg_namespace N on p.pronamespace = N.oid "
                            "WHERE p.proname = '{0}' AND N.oid = {1}".format(TEST_FUNC_NAME, schid))
        try:
            self.fid = self.cursor.fetchone()[0]
        except Exception as e:
            self.skipTest('Specified test function not found')

        self.conn.commit()



    def runTest(self):
        ### init_func tests ###
        response = self.tester.get(
            self.urls[0].format(
                self.server_id,
                self.db_id,
                self.schema_id,
                self.fid
            )
        )
        data = response.json['data']

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data['profile_info'][0]['schema'], self.schema_id)

        trans_id = data['trans_id']
        func_src = data['profile_info'][0]['prosrc']

        ### initialize_target tests ###
        args = []
        for arg in TEST_FUNC_ARGS:
            args.append({
                'name': arg,
                'type': TEST_FUNC_ARGS[arg][1],
                'value': TEST_FUNC_ARGS[arg][0]
            })


        response = self.tester.post(
            self.urls[1].format(
                trans_id,
                self.server_id,
                self.db_id,
                self.schema_id,
                self.fid
            ),
            data=json.dumps(args) if args is not [] else None
        )

        if response.status_code == 500 and response.json['errormsg'] == gettext(
            "The profiler plugin is enabled globally. "
            "Please remove the plugin from the shared_preload_libraries "
            "setting in the postgresql.conf file and restart the "
            "database server for direct profiling."
        ):
            self.skipTest('pl_profiler plugin installed on server in testing config')

        self.assertEqual(response.status_code, 200)

        ### profile_new tests ###
        response = self.tester.get(self.urls[2].format(trans_id))
        self.assertEqual(response.status_code, 200)

        ### get_src tests ###
        response = self.tester.get(self.urls[3].format(trans_id))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(TEST_FUNC_BODY in response.json['data']['result'])

        ### get_parameters tests ###
        response = self.tester.get(self.urls[4].format(trans_id))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json['data']['result']), len(TEST_FUNC_ARGS))
        for i in range(len(TEST_FUNC_ARGS)):
            self.assertEqual(response.json['data']['result'][i], args[i])

        ### get_reports tests ###
        response = self.tester.get(self.urls[5])
        self.assertEqual(response.status_code, 200)
        num_reports = len(response.json['data']['result'])

        ### get_config tests ###
        response = self.tester.get(self.urls[6].format(trans_id))

        self.assertEqual(200, response.status_code)
        self.assertEqual(response.json['data']['status'], 'Success')

        report_name = response.json['data']['result'][0]['value']
        report_title = response.json['data']['result'][1]['value']
        report_tabstop = response.json['data']['result'][2]['value']
        report_svg_width = response.json['data']['result'][3]['value']
        report_table_width = response.json['data']['result'][4]['value']
        report_desc = response.json['data']['result'][5]['value']

        self.assertEqual(report_name, TEST_FUNC_NAME)
        self.assertEqual(report_tabstop, DEFAULT_TABSTOP)
        self.assertEqual(report_svg_width, DEFAULT_SVG_WIDTH)
        self.assertEqual(report_table_width, DEFAULT_TABLE_WIDTH)
        self.assertEqual(report_desc, DEFAULT_DESC)

        ### set_config tests ###
        response = self.tester.post(
            self.urls[7].format(trans_id),
            data=json.dumps([
                {
                    'option': 'Name',
                    'value': TEST_REPORT_NAME
                },
                {
                    'option': 'Title',
                    'value': report_title
                },
                {
                    'option': 'Tabstop',
                    'value': TEST_REPORT_TABSTOP
                },
                {
                    'option': 'SVG_Width',
                    'value': TEST_REPORT_SVG_WIDTH
                },
                {
                    'option': 'Table_Width',
                    'value': TEST_REPORT_TABLE_WIDTH
                },
                {
                    'option': 'Description',
                    'value': TEST_REPORT_DESCRIPTION
                }
            ]))


        self.assertEqual(200, response.status_code)
        self.assertEqual(response.json['data']['status'], 'Success')

        # Get the config again to see if it correctly updated
        response = self.tester.get(self.urls[6].format(trans_id))
        report_name = response.json['data']['result'][0]['value']
        report_tabstop = response.json['data']['result'][2]['value']
        report_svg_width = response.json['data']['result'][3]['value']
        report_table_width = response.json['data']['result'][4]['value']
        report_desc = response.json['data']['result'][5]['value']

        self.assertEqual(report_name, TEST_REPORT_NAME)
        self.assertEqual(report_title, response.json['data']['result'][1]['value'])
        self.assertEqual(report_tabstop, TEST_REPORT_TABSTOP)
        self.assertEqual(report_svg_width, TEST_REPORT_SVG_WIDTH)
        self.assertEqual(report_table_width, TEST_REPORT_TABLE_WIDTH)
        self.assertEqual(report_desc, TEST_REPORT_DESCRIPTION)


        ### start_execution tests ###
        response = self.tester.get(self.urls[8].format(trans_id))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['data']['status'], 'Success')
        self.assertEqual(response.json['data']['result'][0][TEST_FUNC_NAME], TEST_FUNC_RESULT)

        report_id = response.json['data']['report_headers']['report_id']

        # We should now have a new report
        response = self.tester.get(self.urls[5])
        self.assertEqual(num_reports + 1, len(response.json['data']['result']))
        num_reports = len(response.json['data']['result'])

        ### show_report tests ###
        response = self.tester.get(self.urls[9].format(report_id))
        self.assertEqual(response.status_code, 200)

        ### delete_report tests ###
        response = self.tester.post(self.urls[10].format(report_id))
        self.assertEqual(response.status_code, 200)

        # Make sure that the number of reports has lowered
        response = self.tester.get(self.urls[5])
        self.assertEqual(num_reports - 1, len(response.json['data']['result']))
        num_reports = len(response.json['data']['result'])



    def tearDown(self):
        self.cursor.execute('DROP FUNCTION {0}'.format(TEST_FUNC_NAME))
        self.conn.commit()
