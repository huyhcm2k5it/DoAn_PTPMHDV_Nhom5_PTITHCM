"""Deterministic RabbitMQ topology from the 18 events and 5 commands."""
import argparse
import json
import re
from pathlib import Path
from check_baseline import sheet

ROOT=Path(__file__).resolve().parents[2]
OWNERS=("identity","patient","appointment","catalog","clinical","diagnostic","pharmacy","billing","notification")
SOURCES=("appointment","diagnostic","pharmacy")


def generate():
    exchanges=set()
    queues=set()
    bindings=set()
    def bind(owner,kind,key,target):
        exchange="umc."+kind+"."+owner+".v1"
        exchanges.add(exchange)
        queues.add(target)
        bindings.add((exchange,key,target))
    for row in sheet("04_Events_18")[1]:
        if not row.get("Event"):
            continue
        vals=list(row.values())
        producers=re.findall("|".join(OWNERS),vals[1].lower())
        consumers=re.findall("|".join(OWNERS),vals[2].lower())
        if row["Event"]=="BillingStatusChanged":
            consumers=list(set(consumers+list(SOURCES)))
        suffix=re.sub(r"(?<!^)(?=[A-Z])","-",row["Event"]).lower()+".v1"
        for producer in producers:
            for consumer in consumers:
                bind(producer,"events",producer+"."+suffix,"evt."+consumer+".v1")
    for owner in SOURCES:
        for key in ("billing.request-charge.v1","billing.query-settlement.v1"):
            bind(owner,"commands",key,"cmd.billing.v1")
        bind("billing","commands",owner+".reserve-settlement.v1","cmd."+owner+".v1")
    bind("clinical","commands","diagnostic.create-lab-order.v1","cmd.diagnostic.v1")
    bind("clinical","commands","appointment.claim-queue-ticket.v1","cmd.appointment.v1")
    for owner in OWNERS:
        exchange="umc.deadletters."+owner+".v1"
        exchanges.add(exchange)
        queues.add("dlq."+owner+".v1")
        bindings.add((exchange,"#","dlq."+owner+".v1"))
    return {
        "rabbit_version":"4.3.6",
        "vhosts":[{"name":"/umc-care"}],
        "exchanges":[{"name":name,"vhost":"/umc-care","type":"topic","durable":True,"auto_delete":False} for name in sorted(exchanges)],
        "queues":[{"name":name,"vhost":"/umc-care","durable":True,"auto_delete":False,"arguments":{"x-queue-type":"quorum"}} for name in sorted(queues)],
        "bindings":[{"source":e,"vhost":"/umc-care","destination":q,"destination_type":"queue","routing_key":key,"arguments":{}} for e,key,q in sorted(bindings)],
        "policies":[{"vhost":"/umc-care","name":owner+"-dlq","pattern":"^(evt|cmd)\\."+owner+"\\.v1$",
                     "apply-to":"queues","priority":10,
                     "definition":{"dead-letter-exchange":"umc.deadletters."+owner+".v1"}} for owner in OWNERS],
        "parameters":[],
    }


if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--write",action="store_true")
    args=p.parse_args()
    path=ROOT/"rabbitmq/definitions.json"
    expected=generate()
    if args.write:
        path.write_text(json.dumps(expected,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    if json.loads(path.read_text(encoding="utf-8")) != expected:
        raise SystemExit("Topology drift: review and regenerate explicitly.")
    print("PASS canonical RabbitMQ topology")
