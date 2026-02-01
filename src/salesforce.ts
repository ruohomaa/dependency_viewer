import { Connection } from 'jsforce';

export async function login(instanceUrl: string, accessToken: string): Promise<Connection>;
export async function login(username: string, password: string, loginUrl?: string): Promise<Connection>;
export async function login(arg1: string, arg2: string, arg3?: string): Promise<Connection> {
  let conn: Connection;
  
  if (arg3 || (!arg1.startsWith('http') && !arg2.startsWith('00D'))) {
    // Username/password login
    conn = new Connection({
      loginUrl: arg3 || 'https://login.salesforce.com'
    });
    await conn.login(arg1, arg2);
  } else {
    // Instance URL/Access Token login
    conn = new Connection({
      instanceUrl: arg1,
      accessToken: arg2
    });
  }
  return conn;
}

export async function fetchDependencies(conn: Connection) {
  const query = 'SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency';
  
  let records: any[] = [];
  let result = await conn.tooling.query(query);
  records = records.concat(result.records);

  while (!result.done) {
    result = await conn.tooling.queryMore(result.nextRecordsUrl as string);
    records = records.concat(result.records);
  }

  return records;
}
