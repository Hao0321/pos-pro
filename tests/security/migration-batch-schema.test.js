import {describe,it,expect} from 'vitest'
import Ajv2020 from 'ajv/dist/2020.js'
import schema from '../../public/agent/migration-batch-v1.schema.json'
import manifest from '../../public/agent/manifest.json'
import known from '../../public/.well-known/pos-agent.json'
import {migrationHandoff} from '../../electron/migrationSource.mjs'
import {makeMigrationBatchDraft,readMigrationBatchDraft} from '../../electron/migrationBatchDraft.mjs'
import catalogue from '../../public/i18n/catalogue/migration-batch.mjs'
import messages from '../../public/i18n/messages.mjs'
import data from './migrationBatchFixture.cjs'
const validate=new Ajv2020({strict:true,allErrors:true}).compile(schema)
describe('M46 public original-source contract',()=>{
 it('advertises the actual local batch schema and owner review without external write authority',()=>{const handoff=migrationHandoff(),profile=manifest.migrationDraft.sourceBatch;expect(handoff.sourceBatch).toMatchObject({protocol:'pos-migration-batch/v1',schema:'/agent/migration-batch-v1.schema.json',maxFiles:20,humanReviewRequired:true,externalAgentWriteApi:false});expect(profile.protectionVersion).toBe(21);expect(known.migrationBatchDraft.schema).toBe(profile.schema);expect(handoff.businessCommit).toBe(false);expect(handoff.openingBalances.rawFinancialFiles).toBe(true);expect(profile.fullMigrationComplete).toBe(false);expect(profile.installerUpdated).toBe(false);expect(handoff).not.toHaveProperty('actor');expect(handoff).not.toHaveProperty('confirmed')})
 it.each(['masters','stock','mixed'])('admits complete raw %s sources through both the public schema and runtime identity validator',mode=>{const raw=makeMigrationBatchDraft(data.source,'TWD',data[mode]());expect(validate(raw),JSON.stringify(validate.errors)).toBe(true);expect(readMigrationBatchDraft(raw)).toBe(raw);expect(validate({...raw,actor:{role:'owner'}})).toBe(false);expect(validate({...raw,confirmed:true})).toBe(false);expect(validate({...raw,files:[...raw.files,...Array(21).fill(raw.files[0])]})).toBe(false)})
 it('keeps schema shape separate from actual raw identity and original-write admission',()=>{const raw=makeMigrationBatchDraft(data.source,'TWD',data.masters()),changed=structuredClone(raw);changed.files[0].file.text+='changed source';expect(validate(changed)).toBe(true);expect(()=>readMigrationBatchDraft(changed)).toThrow();expect(validate({...raw,files:[{...raw.files[0],file:{...raw.files[0].file,command:'execute'}}]})).toBe(false)})
 it('merges the literal new task/notice translations without leaving Chinese fallback in the other primary languages',()=>{for(const [key,row]of Object.entries(catalogue)){expect(messages[key],key).toEqual(row);expect(row).toHaveLength(3);expect(row[0]).not.toBe(key);expect(row[1]).not.toBe(key)}})
})
