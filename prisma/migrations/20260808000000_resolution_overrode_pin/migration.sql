-- daatan#1234 check #2: resolve-time pin-acknowledgment gate. Null unless the
-- gate fired (a settlement pin or extreme AI confidence contradicted the
-- declared outcome) and the resolver explicitly acknowledged it -- kept
-- nullable rather than defaulted to false so "gate never fired" stays
-- distinguishable from "acknowledged" for the future calibration-record
-- marking (check #3).
ALTER TABLE "predictions" ADD COLUMN "resolution_overrode_pin" BOOLEAN;
