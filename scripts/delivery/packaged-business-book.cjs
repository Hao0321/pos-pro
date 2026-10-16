const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
// Login audit rows and the isolated server port change on process restart.
// Every other exported business collection is compared, including both ledgers.
const keys=['products','members','orders','suppliers','purchases','promotions','users','manualJournal','heldOrders','shifts','cashLog','wasteLog','memberTopups','restaurantOrders','restaurantOperations','salesDocuments','salesOperations','customerEntries','customerOperations','supplierEntries','supplierOperations']
const snapshot=book=>Object.fromEntries(keys.map(key=>{assert.ok(Array.isArray(book[key]),'missing delivered business collection '+key);return [key,book[key]]}))
const file=profile=>path.join(profile,'delivered-business-book.json')
function save(profile,book){fs.writeFileSync(file(profile),JSON.stringify({schemaVersion:1,book:snapshot(book)},null,2),{flag:'wx'})}
function expected(profile){return JSON.parse(fs.readFileSync(file(profile),'utf8')).book}
function same(actual,wanted,label){for(const key of keys)assert.deepEqual(actual[key],wanted[key],label+': '+key)}
module.exports={keys,snapshot,save,expected,same}
