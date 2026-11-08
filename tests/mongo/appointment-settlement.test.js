const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mongoHarness } = require('./test-harness');
const { ensureAppointmentStorage } = require('../../services/appointment/src/dbs/indexes');
const { handleReserveSettlementCommand } = require('../../services/appointment/src/workers/billing-events.worker');
const h = mongoHarness(ensureAppointmentStorage, 'appointment_db');
const now = new Date('2026-11-08T00:00:00Z');
async function seed(overrides = {}) {
 const row = {id:randomUUID(),requestId:randomUUID(),holdId:randomUUID(),patientId:randomUUID(),principalId:randomUUID(),slotId:randomUUID(),scheduleId:randomUUID(),doctorId:randomUUID(),serviceId:randomUUID(),startAt:now,endAt:new Date(+now+3600000),sourceRevision:1,version:2,state:'PENDING_PAYMENT',chargeSync:'CREATED',chargeId:randomUUID(),priceSnapshot:{amountVnd:100,snapshotHash:'accepted'},paymentDueAt:new Date(+now+600000),createdAt:now,updatedAt:now,...overrides};
 await h.connection.collection('appointments').insertOne(row); return row;
}
function command(row, patch = {}) { return {messageId:randomUUID(),messageKind:'COMMAND',messageType:'ReserveSettlement',requestId:randomUUID(),correlationId:randomUUID(),saga:{id:'settlement-1'},payload:{sourceType:'APPOINTMENT',sourceId:row.id,sourceRevision:1,chargeId:row.chargeId,settlementId:'settlement-1',attemptVersion:1,amountHash:'accepted',...patch}}; }
for (const [name,overrides,patch] of [['expired',{paymentDueAt:new Date(+now-1)},{}],['wrong hash',{}, {amountHash:'forged'}],['wrong version',{}, {attemptVersion:99}]]) test(name+' reserve is durably rejected',async()=>{const row=await seed(overrides);const result=await handleReserveSettlementCommand({connection:h.connection,message:command(row,patch),now});assert.equal(result.state,'REJECTED');assert.equal(await h.connection.collection('outbox').countDocuments({message_type:'SettlementReserved'}),1);});
test('FAILED tombstone rejects late reserve',async()=>{const row=await seed();await h.connection.collection('settlement_decisions').insertOne({sourceId:row.id,sourceRevision:1,settlementId:'settlement-1',decisionVersion:1,state:'FAILED'});assert.equal((await handleReserveSettlementCommand({connection:h.connection,message:command(row),now})).state,'REJECTED');});
test('same settlement intent replays saved fence and response',async()=>{const row=await seed();const msg=command(row);const a=await handleReserveSettlementCommand({connection:h.connection,message:msg,now});const first=await h.connection.collection('outbox').findOne({});await h.connection.collection('outbox').updateOne({_id:first._id},{$set:{published_at:now}});const b=await handleReserveSettlementCommand({connection:h.connection,message:{...msg,messageId:randomUUID()},now});assert.equal(a.fence,b.fence);assert.equal(await h.connection.collection('outbox').countDocuments({}),1);assert.equal((await h.connection.collection('outbox').findOne({})).published_at,null);});

test('canonical UNKNOWN decision without undocumented sourceType retains lock', async () => {
 const {handleBillingMessage}=require('../../services/appointment/src/workers/billing-events.worker');
 const row=await seed({state:'SETTLEMENT_LOCKED',settlementId:randomUUID(),fence:7});
 await handleBillingMessage({connection:h.connection,now,message:{messageId:randomUUID(),messageType:'SettlementDecision',producer:'billing',messageKind:'EVENT',payload:{sourceId:row.id,sourceRevision:row.sourceRevision,settlementId:row.settlementId,decisionVersion:1,state:'UNKNOWN'}}});
 assert.equal((await h.connection.collection('appointments').findOne({id:row.id})).state,'SETTLEMENT_LOCKED');
});
