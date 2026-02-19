export interface LdapConfig {
  url: string;
  baseDN: string;
  bindDN: string;
  bindPassword: string;
}

export function getLdapConfig(): LdapConfig {
  return {
    url: process.env.LDAP_URL || 'ldap://localhost',
    baseDN: process.env.LDAP_BASE_DN || 'DC=domain,DC=local',
    bindDN: process.env.LDAP_BIND_DN || '',
    bindPassword: process.env.LDAP_BIND_PASSWORD || '',
  };
}

export function getUserSearchBase(baseDN: string): string {
  return baseDN;
}

export function getUserFilter(username: string): string {
  return `(&(objectClass=user)(sAMAccountName=${username}))`;
}

export function getGroupSearchBase(baseDN: string): string {
  return baseDN;
}

export function getGroupFilter(userDN: string): string {
  return `(&(objectClass=group)(member=${userDN}))`;
}
