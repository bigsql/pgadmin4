{### Fetch the function definitions ###}

WITH SELF AS (SELECT stack[array_upper(stack, 1)] as func_oid,
                     sum(us_self) as us_self
              {% if data_location == 'local' %}
              FROM pl_profiler_callgraph_local() C

              {% elif data_location == 'shared' %}
              FROM pl_profiler_callgraph_shared() C

              {% endif %}

              GROUP BY func_oid)
SELECT P.oid, N.nspname, P.proname,
       pg_catalog.pg_get_function_result(P.oid),
       pg_catalog.pg_get_function_arguments(P.oid),
       coalesce(SELF.us_self, 0) AS self_time
FROM pg_catalog.pg_proc P
  JOIN pg_catalog.pg_namespace N ON N.oid = P.pronamespace
  LEFT JOIN SELF ON SELF.func_oid = P.oid
WHERE P.oid = {{ func_oid }}
