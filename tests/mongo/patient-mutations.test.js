const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mongoHarness } = require('./test-harness');
const { ensurePatientStorage } = require('../../services/patient/src/dbs/indexes');
const { getPatientModel } = require('../../services/patient/src/models/patient.model');
const { createPatient } = require('../../services/patient/src/services/manage-patient.service');
const h = mongoHarness(ensurePatientStorage, 'patient_db');
async function input(actorType='PATIENT') {const userId=randomUUID();await h.connection.collection('user_access_projection').insertOne({userId,status:'ACTIVE',actorType,capabilities:['RECEPTION'],tokenVersion:1});return {connection:h.connection,Patient:getPatientModel(h.connection),authContext:{userId,actorType,tokenVersion:1},body:{fullName:'A Patient',birthDate:'1990-01-01',relation:'SELF'},idempotencyKey:randomUUID()};}
test('same intent creates one profile audit and outbox',async()=>{const args=await input();const first=await createPatient(args);const second=await createPatient(args);assert.equal(first.id,second.id);assert.equal(await h.connection.collection('patients').countDocuments({}),1);assert.equal(await h.connection.collection('profile_audit').countDocuments({}),1);assert.equal(await h.connection.collection('outbox').countDocuments({}),1);});
test('changed body same key returns 409',async()=>{const args=await input();await createPatient(args);await assert.rejects(createPatient({...args,body:{...args.body,fullName:'Changed'}}),e=>e.status===409 || e.statusCode===409);});
test('reception cannot assign unverified account',async()=>{const args=await input('STAFF');await assert.rejects(createPatient({...args,body:{...args.body,ownerUserId:randomUUID()}}),e=>e.status===403 || e.statusCode===403);});
test('patient cannot forge another owner',async()=>{const args=await input();await assert.rejects(createPatient({...args,body:{...args.body,ownerUserId:randomUUID()}}),e=>e.status===403 || e.statusCode===403);});
