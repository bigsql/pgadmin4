{### Fetch the linestats for each line ###}

SELECT L.func_oid, L.line_number,
    sum(L.exec_count)::bigint AS exec_count,
    sum(L.total_time)::bigint AS total_time,
    max(L.longest_time)::bigint AS longest_time,
    S.source

{% if data_location == 'local' %}

FROM pl_profiler_linestats_local() L
JOIN pl_profiler_funcs_source(pl_profiler_func_oids_local()) S

{% elif data_location == 'shared' %}

FROM pl_profiler_linestats_shared() L
JOIN pl_profiler_funcs_source(pl_profiler_func_oids_shared()) S
{% endif %}

   ON S.func_oid = L.func_oid
   AND S.line_number = L.line_number
GROUP BY L.func_oid, L.line_number, S.source
ORDER BY L.func_oid, L.line_number
