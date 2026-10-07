import { beforeAll, afterAll, test, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222'
const tables=['products','members','orders','suppliers','purchases','promotions','manual_journal','held_orders','shifts','cash_log','waste_log','member_topups','audit_log']
let pg
beforeAll(async()=>{
  pg=new PGlite()
  await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated;CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA auth TO public;GRANT EXECUTE ON FUNCTION auth.uid() TO public;`)
  await pg.exec(readFileSync(new URL('../../supabase/schema.sql',import.meta.url),'utf8'))
  // Legacy permissive policy is an adversarial control: the new boundary must still hold.
  await pg.exec('CREATE POLICY old_wide_open ON products FOR ALL TO authenticated USING (true) WITH CHECK (true)')
  await pg.exec(`SET request.jwt.claim.sub='${owner}';SET ROLE authenticated;`)
  const extra={products:{name:'商品'},members:{name:'會員'},orders:{time:'fixture'},suppliers:{name:'廠商'},purchases:{},promotions:{name:'優惠',type:'fixed'},manual_journal:{date:'fixture'},held_orders:{createdAt:'fixture'},shifts:{cashier:'測試',openTime:'fixture'},cash_log:{time:'fixture',type:'in',amount:1},waste_log:{productId:'p',qty:1,time:'fixture'},member_topups:{memberId:'m',amount:1,time:'fixture'},audit_log:{timestamp:'fixture',action:'test'}}
  for(const table of tables){const row={id:'owned-'+table,...extra[table]},keys=Object.keys(row);await pg.query(`INSERT INTO ${table} (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row))}
},30000)
afterAll(async()=>{await pg?.close()})
test.each(tables)('PostgreSQL RLS for %s allows its owner and hides it from another identity',async table=>{
  await pg.exec(`RESET ROLE;SET request.jwt.claim.sub='${owner}';SET ROLE authenticated;`)
  expect((await pg.query(`SELECT id FROM ${table}`)).rows).toHaveLength(1)
  await pg.exec(`SET request.jwt.claim.sub='${other}'`)
  expect((await pg.query(`SELECT id FROM ${table}`)).rows).toHaveLength(0)
  expect((await pg.query(`UPDATE ${table} SET id='stolen' WHERE id=$1 RETURNING id`,['owned-'+table])).rows).toHaveLength(0)
})
test.each(tables)('anonymous SQL cannot read %s',async table=>{
  await pg.exec('RESET ROLE;SET ROLE anon')
  await expect(pg.query(`SELECT * FROM ${table}`)).rejects.toThrow('permission denied')
})
test('restrictive policy rejects forged owner insert/update even alongside a legacy allow-all policy',async()=>{
  await pg.exec(`RESET ROLE;SET request.jwt.claim.sub='${owner}';SET ROLE authenticated;`)
  await expect(pg.query('INSERT INTO products(id,name,owner_id) VALUES ($1,$2,$3)',['forged','偽造',other])).rejects.toThrow('row-level security')
  await expect(pg.query('UPDATE products SET owner_id=$1',[other])).rejects.toThrow('row-level security')
})
test.each(['anon','authenticated'])('cloud employee password hashes are unavailable to %s',async role=>{
  await pg.exec('RESET ROLE;SET ROLE '+role)
  await expect(pg.query('SELECT password FROM users')).rejects.toThrow('permission denied')
})
