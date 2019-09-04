import json

from pgadmin.utils.route import BaseTestGenerator
from regression.python_test_utils import test_utils as utils


TEST_DURATION = 3
TEST_INTERVAL = 1
TEST_PID = None

class IndirectProfilingTest(BaseTestGenerator):
    scenarios = [
        ('Testcase for indirect profiling', {
            'urls': [
                '/profiler/init/database/{0}/{1}',
                '/profiler/initialize_target_indirect/{0}/{1}/{2}/',
                '/profiler/profile/{0}',
                '/profiler/get_src/{0}',
                '/profiler/get_parameters/{0}',
                '/profiler/start_monitor/{0}'
            ],
        }),
    ]

    def setUp(self):
        super(IndirectProfilingTest, self).setUp()
        self.config_data = utils.get_config_data()[0]
        self.conn = utils.get_db_connection(
            db=self.config_data['db'],
            username=self.config_data['username'],
            password=self.config_data['db_password'],
            host=self.config_data['host'],
            port=self.config_data['port'],
            sslmode=self.config_data['sslmode'])


        self.cursor = self.conn.cursor()
        self.cursor.execute("""
                        SELECT N.nspname
                        FROM pg_catalog.pg_extension E
                        JOIN pg_catalog.pg_namespace N ON N.oid = E.extnamespace
                        WHERE E.extname = 'plprofiler'
                    """)
        res = self.cursor.fetchone()[0]
        self.schema_name = res

        self.db_name = self.config_data['db']
        self.cursor.execute("SELECT db.oid from pg_database db WHERE"
                            " db.datname='%s'" % self.db_name)
        self.db_id = self.cursor.fetchone()[0]

    def runTest(self):
        ### init_function tests ###
        response = self.tester.get(self.urls[0].format(self.server_id, self.db_id))
        data = response.json['data']

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data['db_info']['did'], self.db_id)
        self.assertEqual(data['db_info']['sid'], self.server_id)

        trans_id = int(data['trans_id'])

        ### initialize_target_indirect tests ###

        # Happy path
        response = self.tester.post(
            self.urls[1].format(trans_id, self.server_id, self.db_id),
            data=json.dumps([
                    {
                        'option': 'Duration',
                        'value': TEST_DURATION
                    },
                    {
                        'option': 'Interval',
                        'value': TEST_INTERVAL
                    }
                ]),
            content_type='application/json'
        )
        if (response.status_code == 500):
            if response.json['errormsg'] == ("The profiler plugin is not enabled. "
                "Please add the plugin to the shared_preload_libraries "
                "setting in the postgresql.conf file and restart the "
                "database server for indirect profiling."):
                self.skipTest('pl_profiler plugin not installed on server in testing config')

        self.assertEqual(response.status_code, 200)
        profilerTransId = response.json['data']['profilerTransId']
        self.assertEqual(trans_id, profilerTransId)

        # Invalid Input
        response = self.tester.post(
            self.urls[1].format(trans_id, self.server_id, self.db_id),
            data=json.dumps([
                    {
                        'option': 'Duration',
                        'value': TEST_DURATION
                    },
                    {
                        'option': 'Interval',
                        'value': 'INVALID'
                    }
                ]),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 415)
        self.assertEqual(response.json['errormsg'], 'One or more arguments have invalid input')

        # Wrong trans_id
        response = self.tester.post(
            self.urls[1].format(trans_id + 1, self.server_id, self.db_id),
            data=json.dumps([
                    {
                        'option': 'Duration',
                        'value': TEST_DURATION
                    },
                    {
                        'option': 'Interval',
                        'value': TEST_INTERVAL
                    }
                ]),
            content_type='application/json'
        )
        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.json['errormsg'],
            'Could not find Profiler Instance with given transaction_id')

        ### profile_new tests ###

        # Happy path
        response = self.tester.get(self.urls[2].format(trans_id))
        self.assertEqual(response.status_code, 200)

        # Wrong trans_id
        response = self.tester.get(self.urls[2].format(trans_id + 1))
        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.json['errormsg'],
            'Could not find Profiler Instance with given transaction_id')



        ### get_src tests ###
        response = self.tester.get(self.urls[3].format(trans_id))
        self.assertEqual(
            response.json['data']['status'],
            'Error'
        )

        ### get_parameters tests ###
        response = self.tester.get(self.urls[4].format(trans_id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['data']['status'], 'Success')

        duration = response.json['data']['result'][0]
        interval = response.json['data']['result'][1]
        pid = response.json['data']['result'][2]

        self.assertEqual(duration['value'], TEST_DURATION)
        self.assertEqual(duration['name'], 'Duration')
        self.assertEqual(duration['type'], 'Monitoring Parameter')

        self.assertEqual(interval['value'], TEST_INTERVAL)
        self.assertEqual(interval['name'], 'Interval')
        self.assertEqual(interval['type'], 'Monitoring Parameter')

        self.assertEqual(pid['value'], TEST_PID)
        self.assertEqual(pid['name'], 'PID')
        self.assertEqual(pid['type'], 'Monitoring Parameter')

        ### start_monitor tests ###
        response = self.tester.post(self.urls[5].format(trans_id))

        # Case of no functions called
        self.assertEqual(
            response.json['data']['result'],
            'No profiling data found(Possible cause: No functions were run during the monitoring duration)'
        )

        # Case of functions are called
        # TODO: make new thread? for this
        # response = self.tester.post(self.urls[5].format(trans_id))
        # self.cursor.execute('SELECT test_sum(1 + 2)')
