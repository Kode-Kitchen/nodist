/*!
 * nodist
 * A Node version manager for the windows folks out there.
 * Copyright 2012 by Marcel Klehr <mklehr@gmx.net>
 *
 * (MIT LICENSE)
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

var exec = require('child_process').spawn
  , mkdirp     = require('mkdirp').sync
  , request    = require('request')
  , fs         = require('fs')
  , path       = require('path')
;

module.exports = nodist = function nodist(target, sourceUrl, sourceDir) {
  this.target    = target;
  this.sourceUrl = sourceUrl;
  this.sourceDir = sourceDir;
  
  // Create source dir if unexistant
  mkdirp(sourceDir);
}

nodist.semver = /^v?(\d+\.\d+\.\d+|latest)$/ //| @TODO: Allow `0.6` -> node-v0.6.15

nodist.validateVersion = function validateVersion(ver) {
  if(!ver.match(nodist.semver)) return false;
  return true;
}

nodist.compareable = function compareable(ver) {
  var parts = ver.split('.');
  return parseInt(parts.map(function(d){ while(d.length < 3) d = '0'+d; return d; }).join(''), 10);
}

nodist.determineVersion = function determineVersion(file, cb) {
  var returned = false;
  
  var node = exec(file, ['-v']);
  node.stdout.on('data', function (data) {
    var version = data.toString().trim().replace(nodist.semver, '$1');
    if(!returned) cb(null, version);
    returned = true;
  });
  node.on('error', function (err) {
    if(!returned) cb(err);
    returned = true;
  });
  node.on('exit', function (err) {
    if(!returned) cb(err);
    returned = true;
  });
}

nodist.prototype.fetch = function fetch(version, fetch_target, _cb) {
  var n = this;
  var url = this.sourceUrl+'/'+(version=='latest'?'':'v')+version+'/node.exe';
  
  // Check online availability
  if(nodist.compareable(version) < nodist.compareable('0.5.1')) {
    return _cb(new Error('There are no builds available for versions older than 0.5.1.'));
  }
  
  // Clean up things on error and rename latest to real version
  var cb = function(err) {
    if(err) {
      fs.unlinkSync(fetch_target);
      return _cb(err);
    }
    if(version == 'latest') {
      // clean up "latest.exe"
      nodist.determineVersion(fetch_target, function (err, real_version) {
        fs.renameSync(fetch_target, n.sourceDir+'/'+real_version+'.exe');
        _cb(null, real_version);
      });
    }else
    return _cb(null, version);
  };
  
  // fetch from url
  var stream = request(url, function(err, resp){
    if(err || resp.statusCode != 200) {
      return cb(new Error('Couldn\'t fetch '+version+' ('+(err? err.message : 'HTTP '+resp.statusCode)+')'));
    }
    cb();
  });
  stream.pipe(fs.createWriteStream(fetch_target));
  stream.on('error', cb);
};

nodist.prototype.checkout = function checkout(source, cb) {
  var n = this;
  source = fs.createReadStream(source);
  source.pipe(fs.createWriteStream(this.target)).on('close', cb);
  source.on('error', function(err) {
    fs.unlink(n.target, function(e) {
      if(e) return cb(new Error(err.msg+'. Couldn\'t clean up globally used version ('+e.message+')'));
      cb(new Error(err.message));
    });
  });
};

nodist.prototype.listInstalled = function listInstalled(cb) {
  fs.readdir(this.sourceDir, function(err, ls){
    if(err) return cb(err);
    
    ls = ls.map(function(v) {
      return v.replace(/^(.+)\.exe$/, '$1');
    });
    ls.sort(function(val1, val2){
      return nodist.compareable(val1) > nodist.compareable(val2) ? 1 : -1;
    });
    return cb(null, ls);
  })
};

nodist.prototype.deploy = function deploy(version, cb) {
  var n = this;
  var source = this.sourceDir+'/'+version+'.exe';
  
  // checkout source if it exists
  if(fs.existsSync(source)) {
    return this.checkout(source, function(err) {
      if(err) return cb(err);
      cb(null, version);
    });
  }
  
  // fetch build online
  this.fetch(version, source, function(err, real_version) {
    if(err) {
      return cb(err);
    }
    
    n.checkout(n.sourceDir+'/'+real_version+'.exe', function(err) {
      if(err) return cb(err);
      cb(null, real_version);
    });
  });
};

nodist.prototype.remove = function unlink(version, cb) {
  var n = this;
  var source  = this.sourceDir+'/'+version+'.exe';
  
  // delete source if it exists
  if(fs.existsSync(source)) {
    return fs.unlink(source, cb);
  }
  
  return cb();
};

nodist.prototype.emulate = function emulate(version, args, cb) {
  var n = this;
  var source = this.sourceDir+'/'+version+'.exe';
  var run = function(err, real_version) {
    if(err) return cb(err);
    
    source = n.sourceDir+'/'+real_version+'.exe';
    var node = exec(source, args, {
      stdio: 'inherit',
      cwd: path.resolve('.')
    });
    // onexit: cb(err=null, code)
    node.on('exit', cb.bind(n, null));
  }
  
  // fetch source if it doesn't exist
  if(!fs.existsSync(source)) {
    this.fetch(version, source, run);
    return;
  }
  
  return run();
};