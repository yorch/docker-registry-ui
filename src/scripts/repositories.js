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
  return (repositories) => {
    const sorted = repositories.sort();
    const namespaceOf = (repository) => {
      const split = repository.split('/');
      return split.length > min && min > 0 ? getNamespaceName(split, max) : '';
    };
    // Every namespace in use is known before any node is built, so where a node
    // nests depends on the set of names and never on the order they sort in.
    const namespaces = new Set(sorted.map(namespaceOf).filter(Boolean));
    const nodes = new Map();
    const acc = [];
    // A node nests under the longest namespace that is a proper prefix of its
    // own, or sits at the top level when there is none.
    const ensureNode = (namespace) => {
      let node = nodes.get(namespace);
      if (node) {
        return node;
      }
      node = { namespace, repositories: [] };
      nodes.set(namespace, node);
      let parent;
      const segments = namespace.split('/').slice(0, -1);
      for (let i = segments.length - 1; i > 0 && !parent; i--) {
        const prefix = `${segments.slice(0, i).join('/')}/`;
        if (namespaces.has(prefix)) {
          parent = ensureNode(prefix);
        }
      }
      (parent ? parent.repositories : acc).push(node);
      return node;
    };
    sorted.forEach((repository) => {
      const namespace = namespaceOf(repository);
      (namespace ? ensureNode(namespace).repositories : acc).push(repository);
    });
    return acc;
  };
};
