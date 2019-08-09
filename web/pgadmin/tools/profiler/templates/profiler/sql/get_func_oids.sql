{### To fetch function oids from local data ###}

SELECT STACK[ARRAY_UPPER(ARRAY[STACK], 1)] AS func_oid,
       sum(us_self) AS us_self
{% if data_location == 'local' %}
FROM pl_profiler_callgraph_local() C
{% elif data_location == 'shared' %}
FROM pl_profiler_callgraph_shared() C
{% endif %}
GROUP BY func_oid
ORDER BY us_self DESC
LIMIT {{ opt_top + 1 }}
