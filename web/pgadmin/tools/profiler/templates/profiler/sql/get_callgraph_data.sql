{### Fetch the callgraph data###}

SELECT array_to_string(pl_profiler_get_stack(stack), ';'),
       stack,
       call_count,
       us_total,
       us_children,
       us_self
{% if data_location == 'local' %}
FROM pl_profiler_callgraph_local() C

{% elif data_location == 'shared' %}
FROM pl_profiler_callgraph_shared() C
{% endif %}
