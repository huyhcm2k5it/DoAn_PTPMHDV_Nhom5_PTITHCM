import json
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]


class MessageTopology(unittest.TestCase):
    def test_all_sources_have_billing_event_and_command_paths(self):
        d=json.loads((ROOT/"rabbitmq/definitions.json").read_text(encoding="utf-8"))
        bindings={(b["source"],b["routing_key"],b["destination"]) for b in d["bindings"]}
        for owner in ("appointment","diagnostic","pharmacy"):
            self.assertIn(("umc.events."+owner+".v1",owner+".settlement-reserved.v1","evt.billing.v1"),bindings)
            for key in ("billing.request-charge.v1","billing.query-settlement.v1"):
                self.assertIn(("umc.commands."+owner+".v1",key,"cmd.billing.v1"),bindings)
            self.assertIn(("umc.commands.billing.v1",owner+".reserve-settlement.v1","cmd."+owner+".v1"),bindings)
        self.assertTrue(all(q["durable"] and q["arguments"].get("x-queue-type")=="quorum" for q in d["queues"]))


if __name__=="__main__":
    unittest.main()
