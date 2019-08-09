{### Sorts the given func_oids ###}

SELECT P.oid, N.nspname, P.proname
FROM pg_catalog.pg_proc P
JOIN pg_catalog.pg_namespace N ON N.oid = P.pronamespace
WHERE P.oid IN (SELECT * FROM unnest(ARRAY{{ func_oids }}))
ORDER BY upper(nspname), nspname,
        upper(proname), proname
