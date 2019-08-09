{### Fetch the status of the overflow flags###}

SELECT pl_profiler_callgraph_overflow(),
       pl_profiler_functions_overflow(),
       pl_profiler_lines_overflow()
