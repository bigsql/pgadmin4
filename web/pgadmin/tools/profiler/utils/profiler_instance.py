####################################################################################################
#
#
#
#
#
#
####################################################################################################

from flask import session
from threading import Lock
import random

profiler_sessions_lock = Lock()

class ProfilerInstance:
    def __init__(self, trans_id=None):
        if trans_id is None:
            self._trans_id = str(random.randint(1, 9999999))
        else:
            self._trans_id = trans_id

        self._function_data = None
        self._profiler_data = None
        self.load_from_session()

    @property
    def trans_id(self):
        """
        trans_id be readonly with no setter
        """
        return self._trans_id

    @property
    def function_data(self):
        return self._function_data

    @function_data.setter
    def function_data(self, data):
        self._function_data = data
        self.update_session()

    @property
    def profiler_data(self):
        return self._profiler_data

    @profiler_data.setter
    def profiler_data(self, data):
        self._profiler_data = data
        self.update_session()

    @staticmethod
    def get_trans_ids():
        if '__profiler_sessions' in session:
            return [trans_id for trans_id in session['__profiler_sessions']]
        else:
            return []

    def load_from_session(self):
        if '__profiler_sessions' in session:
            if str(self.trans_id) in session['__profiler_sessions']:
                trans_data = session['__profiler_sessions'][str(self.trans_id)]
                self.function_data = trans_data.get('function_data', None)
                self.profiler_data = trans_data.get('profiler_data', None)

    def update_session(self):
        with profiler_sessions_lock:
            if '__profiler_sessions' not in session:
                session['__profiler_sessions'] = dict()

            session['__profiler_sessions'][str(self.trans_id)] = dict(
                function_data=self.function_data,
                profiler_data=self.profiler_data
            )

            print("AAAAAAAAAAAAAAAAAAAAAAAA")
            print('data: ' + str(session['__profiler_sessions'][str(self.trans_id)]))
            print("BBBBBBBBBBBBBBBBBBBBBBBB")

    def clear(self):
        with profiler_sessions_lock:
            if '__profiler_sessions' in session:
                if str(self.trans_id) in session['__profiler_sessions']:
                    session['__profiler_sessions'].pop(str(self.trans_id))
