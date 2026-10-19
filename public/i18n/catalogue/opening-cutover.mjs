const rows={
 '原單貸項':['Original credit','移行元の貸方残高','原单贷项'],
 '可抵付餘額':['Available to allocate','充当可能な残高','可抵付余额'],
 '期初對帳尚未完成':['Opening reconciliation is pending','期首残高の照合は未完了です','期初对账尚未完成'],
 '實際退款方式':['Actual refund method','実際の返金方法','实际退款方式'],
 '本次只抵用原單貸項，不會再收付款。':['This applies an original credit. No money is received or paid again.','元の貸方残高を充当します。新たな入出金は発生しません。','本次只抵用原单贷项，不会再收付款。'],
 '解除後回到原單貸項，這一步不代表收付款。':['Releasing restores the original credit. No money moves in this step.','解除すると元の貸方残高に戻ります。この操作では入出金は発生しません。','解除后回到原单贷项，这一步不代表收付款。'],
 '整批搬家來源、帳款或保存回執需要核對，請保留原編號。':['Check the complete migration source, balances and saved receipt. Keep the original ID.','移行元データ、未決済残高、保存結果を確認し、元の番号を保持してください。','整批搬家来源、账款或保存回执需要核对，请保留原编号。'],
 '整批搬家資料已更新或仍有待核對項目，請重新看結果。':['The migration data changed or still needs review. Check the latest result.','移行データが更新されたか、未確認項目があります。最新の結果を確認してください。','整批搬家资料已更新或仍有待核对项目，请重新看结果。'],
 '保存後的主檔、庫存或帳款與核對結果不同，整批尚未保存。':['The master data, stock or balances did not match the review. The batch was not saved.','保存時のマスタ、在庫または未決済残高が確認結果と一致しません。一括保存は完了していません。','保存后的主档、库存或账款与核对结果不同，整批尚未保存。'],
 '原搬家編號曾經保存，請使用復原引導核對，勿重新搬入。':['This migration ID was saved before. Use recovery to check it before importing again.','この移行番号は保存済みです。再移行せず、復元ガイドで確認してください。','原搬家编号曾经保存，请使用恢复引导核对，勿重新搬入。'],
}
export default Object.fromEntries(Object.entries(rows).map(([key,value],index)=>[key,[...value,36200+index]]))
