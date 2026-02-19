import ldap from 'ldapjs';
import { getLdapConfig, getUserFilter, getUserSearchBase, getGroupFilter, getGroupSearchBase } from '../config/ldap';
import { logger } from '../utils/logger';

function getLdapTlsOptions(): { rejectUnauthorized: boolean } {
  // In production, TLS certificate verification should be enabled
  const rejectUnauthorized = process.env.LDAP_TLS_REJECT_UNAUTHORIZED !== 'false';
  if (!rejectUnauthorized) {
    logger.warn('LDAP TLS certificate verification is disabled. Enable it in production.');
  }
  return { rejectUnauthorized };
}

export interface LdapUserInfo {
  username: string;
  email: string;
  displayName: string;
  distinguishedName: string;
  memberOf: string[];
}

export async function authenticateUser(
  username: string,
  password: string
): Promise<LdapUserInfo | null> {
  const config = getLdapConfig();

  return new Promise((resolve, reject) => {
    const client = ldap.createClient({
      url: config.url,
      tlsOptions: getLdapTlsOptions(),
    });

    client.on('error', (err) => {
      logger.error('LDAP client error:', err);
      reject(err);
    });

    // First bind with service account to search for user
    client.bind(config.bindDN, config.bindPassword, (bindErr) => {
      if (bindErr) {
        logger.error('LDAP service account bind failed:', bindErr);
        client.destroy();
        resolve(null);
        return;
      }

      // Search for user
      const searchOptions: ldap.SearchOptions = {
        filter: getUserFilter(username),
        scope: 'sub',
        attributes: ['sAMAccountName', 'mail', 'displayName', 'distinguishedName', 'memberOf'],
      };

      client.search(getUserSearchBase(config.baseDN), searchOptions, (searchErr, searchRes) => {
        if (searchErr) {
          logger.error('LDAP search error:', searchErr);
          client.destroy();
          resolve(null);
          return;
        }

        let userEntry: LdapUserInfo | null = null;

        searchRes.on('searchEntry', (entry) => {
          const attrs = entry.pojo.attributes;
          userEntry = {
            username: getAttr(attrs, 'sAMAccountName'),
            email: getAttr(attrs, 'mail'),
            displayName: getAttr(attrs, 'displayName'),
            distinguishedName: getAttr(attrs, 'distinguishedName'),
            memberOf: getAttrArray(attrs, 'memberOf'),
          };
        });

        searchRes.on('error', (err) => {
          logger.error('LDAP search result error:', err);
          client.destroy();
          resolve(null);
        });

        searchRes.on('end', () => {
          if (!userEntry) {
            logger.warn(`User not found: ${username}`);
            client.destroy();
            resolve(null);
            return;
          }

          // Try to bind as the user to verify password
          const userClient = ldap.createClient({
            url: config.url,
            tlsOptions: getLdapTlsOptions(),
          });

          userClient.bind(userEntry.distinguishedName, password, (userBindErr) => {
            userClient.destroy();
            client.destroy();

            if (userBindErr) {
              logger.warn(`Authentication failed for user: ${username}`);
              resolve(null);
              return;
            }

            logger.info(`User authenticated: ${username}`);
            resolve(userEntry);
          });
        });
      });
    });
  });
}

export async function getUserGroups(userDN: string): Promise<string[]> {
  const config = getLdapConfig();

  return new Promise((resolve, reject) => {
    const client = ldap.createClient({
      url: config.url,
      tlsOptions: getLdapTlsOptions(),
    });

    client.bind(config.bindDN, config.bindPassword, (bindErr) => {
      if (bindErr) {
        client.destroy();
        reject(bindErr);
        return;
      }

      const searchOptions: ldap.SearchOptions = {
        filter: getGroupFilter(userDN),
        scope: 'sub',
        attributes: ['cn'],
      };

      const groups: string[] = [];

      client.search(getGroupSearchBase(config.baseDN), searchOptions, (searchErr, searchRes) => {
        if (searchErr) {
          client.destroy();
          reject(searchErr);
          return;
        }

        searchRes.on('searchEntry', (entry) => {
          const cn = getAttr(entry.pojo.attributes, 'cn');
          if (cn) groups.push(cn);
        });

        searchRes.on('end', () => {
          client.destroy();
          resolve(groups);
        });

        searchRes.on('error', (err) => {
          client.destroy();
          reject(err);
        });
      });
    });
  });
}

function getAttr(attrs: { type: string; values: string[] }[], name: string): string {
  const attr = attrs.find(a => a.type.toLowerCase() === name.toLowerCase());
  return attr?.values[0] || '';
}

function getAttrArray(attrs: { type: string; values: string[] }[], name: string): string[] {
  const attr = attrs.find(a => a.type.toLowerCase() === name.toLowerCase());
  return attr?.values || [];
}
