/*
 * Copyright (C) 2016-2023 Jones Magloire @Joxit
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import observable from '@riotjs/observable';
import { Http } from './http.js';
import { requestPool } from './request-pool.js';
import { ERROR_CAN_NOT_READ_CONTENT_DIGEST } from './utils.js';

export const supportListManifest = (response) => {
  if (response.mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json') {
    return true;
  }
  if (response.mediaType === 'application/vnd.oci.image.index.v1+json' && Array.isArray(response.manifests)) {
    const manifests = filterWrongManifests(response);
    return (
      manifests.length > 0 &&
      !manifests.some(({ mediaType }) => mediaType !== 'application/vnd.oci.image.manifest.v1+json')
    );
  }
  return false;
};

export const filterWrongManifests = (response) => {
  return response.manifests.filter(
    ({ annotations }) => annotations?.['vnd.docker.reference.type'] !== 'attestation-manifest',
  );
};

export const platformToString = (platform) => {
  if (!platform?.architecture) {
    return 'unknown';
  }
  return platform.architecture + (platform.variant ? platform.variant : '');
};

export class DockerImage {
  constructor(name, tag, { list, registryUrl, onNotify, onAuthentication, useControlCacheHeader, isRegistrySecured }) {
    this.name = name;
    this.tag = tag;
    this.chars = 0;
    this.opts = {
      list,
      registryUrl,
      onNotify,
      onAuthentication,
      useControlCacheHeader,
      isRegistrySecured,
    };
    this.ociImage = false;
    observable(this);
    this.on('get-size', function () {
      if (this.size !== undefined) {
        return this.trigger('size', this.size);
      }
      return this.fillInfo();
    });
    this.on('get-sha256', function () {
      if (this.sha256 !== undefined) {
        return this.trigger('sha256', this.sha256);
      }
      return this.fillInfo();
    });
    this.on('get-date', function () {
      if (this.creationDate !== undefined) {
        return this.trigger('creation-date', this.creationDate);
      }
      return this.fillInfo();
    });
    this.on('content-digest-chars', function (chars) {
      this.chars = chars;
    });
    this.on('get-content-digest-chars', function () {
      return this.trigger('content-digest-chars', this.chars);
    });
    this.on('get-content-digest', function () {
      if (this.contentDigest !== undefined) {
        return this.trigger('content-digest', this.contentDigest);
      }
      return this.fillInfo();
    });
  }
  // A failed fetch leaves every field undefined, which is indistinguishable
  // from one still in flight, so the row would claim to be loading forever.
  // Report the failure through the events the cells already listen on, using
  // the same convention as the catalog tag counts: undefined is pending, null
  // could not be fetched.
  markUnavailable() {
    this.size = this.size === undefined ? null : this.size;
    this.creationDate = this.creationDate === undefined ? null : this.creationDate;
    this.trigger('size', this.size);
    this.trigger('creation-date', this.creationDate);
    this.trigger('blobs', this.blobs || null);
  }
  fillInfo() {
    if (this._fillInfoWaiting) {
      return;
    }
    this._fillInfoWaiting = true;
    requestPool.submit((done) => this.sendFillInfo(done));
  }
  // `getBlobs` below is submitted separately from this handler rather than run
  // inside this slot, so a pool full of manifest requests cannot sit waiting on
  // work that is queued behind it.
  sendFillInfo(done) {
    const oReq = new Http({
      onAuthentication: this.opts.onAuthentication,
      withCredentials: this.opts.isRegistrySecured,
    });
    const self = this;
    oReq.addEventListener('loadend', function () {
      done();
      if (this.status === 200 || this.status === 202) {
        const response = JSON.parse(this.responseText);
        oReq.getContentDigest((contentDigest) => {
          self.contentDigest = contentDigest;
          self.trigger('content-digest', contentDigest);
          if (!contentDigest) self.opts.onNotify(ERROR_CAN_NOT_READ_CONTENT_DIGEST);
        });
        if (supportListManifest(response) && self.opts.list) {
          const manifests = filterWrongManifests(response);
          self.isIndex = true;
          self.manifests = manifests;
          self.variants = [];
          // An index has no single creation date or image size. Presenting the
          // first child as the whole tag made the digest, size and date depend
          // on descriptor order. The details view resolves every platform.
          self.size = null;
          self.creationDate = null;
          self.trigger('list', manifests);
          self.trigger('size', self.size);
          self.trigger('creation-date', self.creationDate);
          return;
        }
        self.ociImage = response.mediaType === 'application/vnd.oci.image.index.v1+json';
        self.layers = response.layers || response.manifests;
        self.annotations = response.annotations;
        self.size = self.layers.reduce((acc, e) => acc + e.size, 0);
        self.sha256 = response.config?.digest;
        self.trigger('size', self.size);
        self.trigger('sha256', self.sha256);
        if (!self.ociImage) {
          self.getBlobs(self.sha256);
        } else {
          // Force updates
          self.trigger('creation-date');
          self.trigger('blobs');
          self.trigger('oci-image');
        }
      } else if (this.status === 404) {
        self.markUnavailable();
        self.opts.onNotify(`Manifest for ${self.name}:${self.tag} not found`, true);
      } else {
        self.markUnavailable();
        self.opts.onNotify(this.responseText);
      }
    });
    oReq.open('GET', `${this.opts.registryUrl}/v2/${self.name}/manifests/${self.tag}`);
    oReq.setRequestHeader(
      'Accept',
      'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json' +
        (self.opts.list ? ', application/vnd.docker.distribution.manifest.list.v2+json' : ''),
    );
    if (self.opts.useControlCacheHeader) {
      oReq.setRequestHeader('Cache-Control', 'no-store, no-cache');
    }
    oReq.send();
  }
  getBlobs(blob) {
    requestPool.submit((done) => this.sendGetBlobs(blob, done));
  }
  sendGetBlobs(blob, done) {
    const oReq = new Http({
      onAuthentication: this.opts.onAuthentication,
      withCredentials: this.opts.isRegistrySecured,
    });
    const self = this;
    oReq.addEventListener('loadend', function () {
      done();
      if (this.status === 200 || this.status === 202) {
        const response = JSON.parse(this.responseText);
        self.creationDate = new Date(response.created || self.annotations?.['org.opencontainers.image.created']);
        self.blobs = response;
        self.blobs.history = self.blobs.history || [];
        self.blobs.history
          .filter((e) => !e.empty_layer)
          .forEach((e, i) => {
            e.size = self.layers[i].size;
            e.id = self.layers[i].digest.replace('sha256:', '');
          });
        self.blobs.id = blob.replace('sha256:', '');
        self.trigger('creation-date', self.creationDate);
        self.trigger('blobs', self.blobs);
      } else if (this.status === 404) {
        self.markUnavailable();
        self.opts.onNotify(`Blobs for ${self.name}:${self.tag} not found: blob '${self.blobs}'`, true);
      } else if (!this.responseText) {
        self.markUnavailable();
        self.opts.onNotify(
          `Can"t get blobs for ${self.name}:${self.tag}: blob '${self.blobs}' (no message error)`,
          true,
        );
      } else {
        self.markUnavailable();
        self.opts.onNotify(this.responseText);
      }
    });
    oReq.open('GET', `${this.opts.registryUrl}/v2/${self.name}/blobs/${blob}`);
    oReq.setRequestHeader(
      'Accept',
      'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json',
    );
    oReq.send();
  }
}
