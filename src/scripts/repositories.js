import { DockerRegistryUIError } from './error.js';

const ERROR_CODE = 'CATALOG_BRANCHING_CONFIGURATION';

/*
 * Vocabulary, matching the Distribution API rather than contradicting it:
 * a REPOSITORY is a pullable name such as `team/service-a`, and a NAMESPACE is
 * the leading path segment several repositories are grouped under for display.
 * This file turns a flat list of repositories into a tree of namespace nodes,
 * `{ namespace, repositories: [...] }`, mixed with bare repository strings for
 * anything that was not grouped.
 */
const getNamespaceName = (split, max) => {
  let namespace = '';
  for (let i = 0; i < Math.min(max, split.length - 1); i++) {
    namespace += `${split[i]}/`;
  }
  return namespace;
};

const getLatestNamespace = (node, namespace) => {
  if (!node.repositories) {
    return;
  }
  if (node.namespace === namespace) {
    return node;
  }
  for (let i = 0; i < node.repositories.length; i++) {
    const res = getLatestNamespace(node.repositories[i], namespace);
    if (res) {
      return res;
    }
  }

  if (namespace.startsWith(node.namespace)) {
    const child = { namespace, repositories: [] };
    node.repositories.push(child);
    return child;
  }
};

const cleanInt = (n) => (n === '' ? 1 : parseInt(n, 10));

export const getBranching = (min = 1, max = 1) => {
  min = cleanInt(min);
  max = cleanInt(max);
  // Both have been through cleanInt, so they are numbers already and the
  // non-coercing check is exactly equivalent to the global isNaN this replaced.
  if (Number.isNaN(min) || Number.isNaN(max)) {
    throw new DockerRegistryUIError(`min and max must be integers: (min: ${min} and max: ${max}))`, ERROR_CODE);
  } else if (min > max) {
    throw new DockerRegistryUIError(`min must be inferior to max (min: ${min} <= max: ${max})`, ERROR_CODE);
  } else if (max < 0 || min < 0) {
    throw new DockerRegistryUIError(
      `min and max must be greater than equals to 0 (min: ${min} >= 0 and max: ${max} >= 0)`,
      ERROR_CODE,
    );
  }
  if (max == 1) {
    min = 1;
  }
  return (repositories) =>
    repositories.sort().reduce((acc, repository) => {
      const split = repository.split('/');
      if (split.length > min && min > 0) {
        const namespace = getNamespaceName(split, max);
        let node = acc.length > 0 && getLatestNamespace(acc[acc.length - 1], namespace);
        if (!node) {
          node = {
            namespace,
            repositories: [],
          };
          acc.push(node);
        }
        node.repositories.push(repository);
        return acc;
      }
      acc.push(repository);
      return acc;
    }, []);
};
