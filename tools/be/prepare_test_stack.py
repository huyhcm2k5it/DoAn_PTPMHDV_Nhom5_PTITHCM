"""Prepare a separate, fake-data-only Compose project; never read/overwrite owner .env."""
import argparse
import base64
import json
import secrets
from pathlib import Path
import yaml
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

ROOT=Path(__file__).resolve().parents[2]
RUNTIME=ROOT/".runtime/be-test"
PROFILE=ROOT/"infra/compose/be.test.yaml"


def prepare():
    RUNTIME.mkdir(parents=True,exist_ok=True)
    config_path=RUNTIME/"secrets.json"
    if config_path.exists():
        values=json.loads(config_path.read_text(encoding="utf-8"))
    else:
        values={key:secrets.token_hex(24) for key in (
            "POSTGRES_PASSWORD","IDENTITY_DB_PASSWORD","BILLING_DB_PASSWORD","NOTIFICATION_DB_PASSWORD",
            "CATALOG_DB_PASSWORD","CLINICAL_DB_PASSWORD","DIAGNOSTIC_DB_PASSWORD",
            "MONGO_ROOT_PASSWORD","PATIENT_DB_PASSWORD","APPOINTMENT_DB_PASSWORD","PHARMACY_DB_PASSWORD",
            "RABBITMQ_PASSWORD","CATALOG_REDIS_PASSWORD","APPOINTMENT_REDIS_PASSWORD","DJANGO_SECRET_KEY")}
        values.update({"MONGO_ROOT_USER":"umc_test_root","RABBITMQ_USER":"umc_test_bootstrap"})
        config_path.write_text(json.dumps(values),encoding="utf-8")
    owners=("identity","patient","appointment","catalog","clinical","diagnostic","pharmacy","billing","notification")
    for owner in owners:
        values.setdefault(owner.upper()+"_RABBIT_PASSWORD",secrets.token_hex(24))
        values[owner.upper()+"_AMQP_URL"]="amqp://"+owner+":"+values[owner.upper()+"_RABBIT_PASSWORD"]+"@rabbitmq:5672/%2Fumc-be-test"
    config_path.write_text(json.dumps(values),encoding="utf-8")
    for owner in ("patient","appointment","pharmacy"):
        values[owner.upper()+"_MONGO_URI"]=(
            "mongodb://"+owner+"-service:"+values[owner.upper()+"_DB_PASSWORD"]+
            "@mongo:27017/"+owner+"_db?authSource="+owner+"_db&replicaSet=rs0")
    values["UMC_AMQP_URL"]="amqp://"+values["RABBITMQ_USER"]+":"+values["RABBITMQ_PASSWORD"]+"@rabbitmq:5672/%2Fumc-care"
    env_path=RUNTIME/"test.env"
    env_path.write_text("\n".join(key+"="+value for key,value in values.items())+"\n",encoding="utf-8")
    key_path=RUNTIME/"jwt_private.pem"
    if not key_path.exists():
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        (RUNTIME/"jwt_public.pem").write_bytes(key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo))
    key=serialization.load_pem_private_key(key_path.read_bytes(),password=None)
    numbers=key.public_key().public_numbers()
    def encode(number):
        return base64.urlsafe_b64encode(number.to_bytes((number.bit_length()+7)//8,"big")).rstrip(b"=").decode()
    (RUNTIME/"jwks.json").write_text(json.dumps({"keys":[{"kty":"RSA","alg":"RS256","use":"sig","n":encode(numbers.n),"e":encode(numbers.e)}]}),encoding="utf-8")
    mongo_key=RUNTIME/"mongo.key"
    if not mongo_key.exists():
        mongo_key.write_text(base64.b64encode(secrets.token_bytes(512)).decode(),encoding="utf-8")
    doc=yaml.safe_load((ROOT/"infra/compose/compose.yaml").read_text(encoding="utf-8"))
    doc["name"]="umc-be-test"
    doc["secrets"]["mongo-keyfile"]["file"]="../../.runtime/be-test/mongo.key"
    services=doc["services"]
    for name,service in services.items():
        service.pop("env_file",None)
        service.pop("restart",None)
        if "volumes" in service:
            service["volumes"]=[v.replace("../../infra/certs/jwt_public.pem","../../.runtime/be-test/jwt_public.pem")
                .replace("../../services/identity/jwt_private.pem","../../.runtime/be-test/jwt_private.pem")
                .replace("../../.runtime/jwks.json","../../.runtime/be-test/jwks.json") for v in service["volumes"]]
        if name in ("identity","billing","notification","billing-worker","notification-worker"):
            service.setdefault("environment",{}).update({
                "DJANGO_SECRET_KEY":"${DJANGO_SECRET_KEY:?set test secret}",
                "DEBUG":"false","ALLOW_DEV_OTP":"false"})
        if name=="gateway":
            service["ports"]=["127.0.0.1:18080:8080"]
    for name,service in services.items():
        owner=name.split("-")[0]
        if owner in owners:
            e=service.setdefault("environment",{})
            e.update({"RABBITMQ_USER":owner,"RABBITMQ_PASSWORD":"${"+owner.upper()+"_RABBIT_PASSWORD}",
                      "RABBITMQ_VHOST":"/umc-be-test",
                      "AMQP_URL":"${"+owner.upper()+"_AMQP_URL}","RABBITMQ_URL":"${"+owner.upper()+"_AMQP_URL}"})
    services["rabbitmq"]["environment"]={
        "RABBITMQ_DEFAULT_USER":"${RABBITMQ_USER}",
        "RABBITMQ_DEFAULT_PASS":"${RABBITMQ_PASSWORD}",
        "RABBITMQ_DEFAULT_VHOST":"/umc-be-test",
    }
    services["identity-worker"]={
        "build":{"context":"../../services/identity","dockerfile":"Dockerfile"},
        "command":["python","manage.py","run_identity_worker"],
        "environment":dict(services["identity"]["environment"]),
        "volumes":services["identity"]["volumes"],
        "depends_on":{"identity":{"condition":"service_healthy"},"rabbitmq":{"condition":"service_healthy"}},
        "networks":["private"],
    }
    PROFILE.write_text(yaml.safe_dump(doc,sort_keys=False,allow_unicode=True),encoding="utf-8")
    print("Prepared isolated umc-be-test project. Local values retained; no owner .env changed.")
    print("Start with: python tools/be/start_test_stack.py")


if __name__=="__main__":
    prepare()
