/*
 * The fixture catalogue.
 *
 * Every repository here exists to demonstrate one thing, and the name says
 * which. They are served together, so a healthy repository and a broken one sit
 * side by side in the catalogue and you can compare them without a restart.
 *
 * To add an edge case, add a repository. The server should not need touching.
 */

export const DOCKER_MANIFEST = 'application/vnd.docker.distribution.manifest.v2+json';
export const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
export const OCI_INDEX = 'application/vnd.oci.image.index.v1+json';
export const CONFIG_MEDIA_TYPE = 'application/vnd.docker.container.image.v1+json';
export const LAYER_MEDIA_TYPE = 'application/vnd.docker.image.rootfs.diff.tar.gzip';

const numbered = (prefix, count) =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(4, '0')}`);

// Fixed so a page looks the same on every run; a moving "3 minutes ago" makes
// screenshots and comparisons useless.
const CREATED = '2026-01-15T09:30:00.000Z';

export const fixtures = [
  {
    name: 'nginx',
    description: 'An ordinary repository. The baseline everything else is compared against.',
    tags: ['latest', '1.27', '1.27.3', '1.26', 'stable'],
    architecture: 'amd64',
    layerSizes: [31_400_000, 4_200_000, 1_900_000],
  },
  {
    name: 'team/service-a',
    description: 'A nested repository name, for the catalogue branching options.',
    tags: ['latest', 'v2.1.0', 'v2.0.0'],
    architecture: 'amd64',
    layerSizes: [12_000_000, 800_000],
  },
  {
    name: 'team/service-b',
    description: 'A sibling of service-a, so a branch has more than one child.',
    tags: ['latest', 'v1.4.2'],
    architecture: 'arm64',
    layerSizes: [9_500_000],
  },
  {
    name: 'huge',
    description: 'Enough tags to paginate hard and to make the request fan-out visible.',
    tags: numbered('build-', 1000),
    architecture: 'amd64',
    layerSizes: [5_000_000],
  },
  {
    name: 'exactly-100',
    description: 'Exactly one default page. The boundary that used to render an empty second page.',
    tags: numbered('tag-', 100),
    architecture: 'amd64',
    layerSizes: [2_048],
  },
  {
    name: 'empty',
    description: 'A repository with no tags at all, for the empty state.',
    tags: [],
    architecture: 'amd64',
    layerSizes: [],
  },
  {
    name: 'oci-index',
    description: 'A multi-architecture OCI index, for the architectures column.',
    tags: ['latest', 'v3'],
    index: [
      { architecture: 'amd64', os: 'linux' },
      { architecture: 'arm64', os: 'linux', variant: 'v8' },
      { architecture: 'ppc64le', os: 'linux' },
    ],
    layerSizes: [7_300_000],
  },
  {
    name: 'single-platform-index',
    description:
      'An OCI index wrapping exactly one manifest, which is what buildx produces for a single-platform build. One platform means one size and one date, so the tag list has to show them rather than "Multiple".',
    tags: ['latest'],
    index: [{ architecture: 'amd64', os: 'linux' }],
    layerSizes: [2_500_000],
  },
  {
    name: 'broken-manifest',
    description: 'Lists tags, but every manifest 404s. Drives the unavailable state in each cell.',
    tags: ['latest', 'v1', 'v2'],
    architecture: 'amd64',
    layerSizes: [1_000_000],
    manifestStatus: 404,
  },
  {
    name: 'no-digest-header',
    description: 'Serves manifests without Docker-Content-Digest, as a registry behind a proxy that strips it does.',
    tags: ['latest'],
    architecture: 'amd64',
    layerSizes: [3_100_000],
    omitDigestHeader: true,
  },
  {
    name: 'slow',
    description: 'Every response is delayed, so loading states stay on screen long enough to look at.',
    tags: ['latest', 'v1', 'v2', 'v3'],
    architecture: 'amd64',
    layerSizes: [15_000_000],
    delayMs: 2000,
  },
];

export const configBlobFor = (fixture) => ({
  created: CREATED,
  architecture: fixture.architecture || 'amd64',
  os: 'linux',
  config: { Env: ['PATH=/usr/local/bin'], Cmd: ['/bin/sh'], WorkingDir: '/' },
  history: (fixture.layerSizes || []).map((_, i) => ({
    created: CREATED,
    created_by: `/bin/sh -c #(nop) ADD file:layer${i + 1}`,
  })),
});
