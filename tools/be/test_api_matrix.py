"""Regression tests reject contract drift rather than counting parsed JSON files."""
import copy
import unittest
from check_api_matrix import validate_documents

class MatrixTests(unittest.TestCase):
    def setUp(self):
        self.row = dict(id="ZZ-001", service="test", method="GET", path="/api/v1/items/{id}", success="200", errors="401", profile="normal", actor="PATIENT", poll="")
        scalar = {"type": "string"}
        envelope = {"type":"object", "properties":{"data":{"type":"object","properties":{"id":scalar},"required":["id"]}, "meta":{"type":"object","properties":{"correlationId":scalar},"required":["correlationId"]}}, "required":["data","meta"]}
        error = {"type":"object","properties":{"error":{"type":"object","properties":{"code":scalar,"message":scalar},"required":["code","message"]},"meta":envelope["properties"]["meta"]},"required":["error","meta"]}
        response = lambda s: {"description":"Result", "content":{"application/json":{"schema":s}}}
        self.op = {"operationId":"ZZ_001", "security":[{"BearerAuth":[]}], "parameters":[{"name":"id","in":"path","required":True,"schema":scalar}], "responses":{"200":response(envelope),"401":response(error)}}
        self.doc={"openapi":"3.1.1","paths":{self.row["path"]:{"get":self.op}},"components":{"securitySchemes":{"BearerAuth":{"type":"http","scheme":"bearer"}},"schemas":{}}}
    def check(self):
        return validate_documents([self.row], {"test":self.doc})
    def test_valid_contract(self): self.assertEqual([],self.check())
    def test_lease_policy_required(self):
        self.row['id']='BI-004';self.op['operationId']='BI_004';self.assertTrue(self.check())
    def test_unresolved_owner_contract(self):
        self.op['responses']['200']['content']['application/json']['schema']['x-unresolved-contract']=True
        self.assertTrue(self.check())
    def test_missing_operation(self):
        self.doc["paths"]={}; self.assertTrue(self.check())
    def test_wrong_path(self):
        self.doc["paths"]["/wrong"]=self.doc["paths"].pop(self.row["path"]); self.assertTrue(self.check())
    def test_missing_status(self):
        del self.op["responses"]["401"]; self.assertTrue(self.check())
    def test_missing_security(self):
        self.op["security"]=[]; self.assertTrue(self.check())
    def test_unresolved_schema(self):
        self.op["responses"]["200"]["content"]["application/json"]["schema"]={"$ref":"#/components/schemas/Missing"}; self.assertTrue(self.check())
    def test_placeholder_schema(self):
        self.op["responses"]["200"]["content"]["application/json"]["schema"]={"type":"object"}; self.assertTrue(self.check())
    def test_duplicate_operation(self):
        self.doc["paths"]["/duplicate"]={"get":copy.deepcopy(self.op)};self.assertTrue(self.check())
    def test_missing_path_parameter(self):
        self.op["parameters"]=[];self.assertTrue(self.check())
    def test_recovery_public(self):
        self.row["profile"]="recovery";self.assertTrue(self.check())
    def test_accepted_without_poll(self):
        self.row["success"]="202";self.op["responses"]["202"]=self.op["responses"].pop("200");self.assertTrue(self.check())

if __name__ == "__main__": unittest.main()
