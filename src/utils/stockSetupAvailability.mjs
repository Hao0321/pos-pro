// Source experiment only. Release enablement requires the I1-I12 delivery gate.
// This is a build capability, never a URL, Agent or stored-data option.
export const stockSetupBrowserEnabled=()=>import.meta.env?.VITE_POS_STOCK_SETUP==='isolated-fixture'
