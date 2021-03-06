var util  = require("util");
var http  = require("http");
var https = require("https");
var EventEmitter = require('events').EventEmitter;

var elasticdump = function(input, output, options){
  var self  = this;

  self.input   = input;
  self.output  = output;
  self.options = options;
  if (!self.options.searchBody)  {
      self.options.searchBody = {"query": { "match_all": {} } };
  }

  self.validationErrors = self.validateOptions();
  self.toLog = true;

  if(options.maxSockets){
    self.log('globally setting maxSockets=' + options.maxSockets);
    http.globalAgent.maxSockets  = options.maxSockets;
    https.globalAgent.maxSockets = options.maxSockets;
  }

  if(self.options.input){
    if(self.options.input === "$"){
      self.inputType = 'stdio';
    }else if(self.options.input.indexOf(":") >= 0){
      self.inputType = 'elasticsearch';
    }else{
      self.inputType  = 'file';
    }

    var InputProto  = require(__dirname + "/lib/transports/" + self.inputType)[self.inputType];
    self.input  = (new InputProto(self, self.options.input));
  }

  if(self.options.output){
    if(self.options.output === "$"){
      self.outputType = 'stdio';
      self.toLog = false;
    }else if(self.options.output.indexOf(":") >= 0){
      self.outputType = 'elasticsearch';
    }else{
      self.outputType = 'file';
    }

    var OutputProto = require(__dirname + "/lib/transports/" + self.outputType)[self.outputType];
    self.output = (new OutputProto(self, self.options.output));
  }
};

util.inherits(elasticdump, EventEmitter);

elasticdump.prototype.log = function(message){
  var self = this;

  if(typeof self.options.logger === 'function'){
    self.options.logger(message);
  }else if(self.toLog === true){
    self.emit("log", message);
  }
};

elasticdump.prototype.validateOptions = function(){
  var self = this;
  var validationErrors = [];

  var required = ['input', 'output'];
  required.forEach(function(v){
    if(!self.options[v]){
      validationErrors.push('`' + v + '` is a required input');
    }
  });

  return validationErrors;
};

elasticdump.prototype.dump = function(callback, continuing, limit, offset, total_writes){
  var self  = this;

  if(self.validationErrors.length > 0){
    self.emit('error', {errors: self.validationErrors});
  }else{

    if(!limit){ limit = self.options.limit;  }
    if(!offset){ offset = self.options.offset; }
    if(!total_writes){ total_writes = 0; }

    if(continuing !== true){
      self.log('starting dump');
    }

    self.input.get(limit, offset, function(err, data){
      if(err){  self.emit('error', err); }
      self.log("got " + data.length + " objects from source " + self.inputType + " (offset: "+offset+")");
      self.output.set(data, limit, offset, function(err, writes){
        var toContinue = true;
        if(err){
          self.emit('error', err);
          if( self.options['ignore-errors'] === true || self.options['ignore-errors'] === 'true' ){
            toContinue = true;
          }else{
            toContinue = false;
          }
        }else{
          total_writes += writes;
          self.log("sent " + data.length + " objects to destination " + self.outputType + ", wrote " + writes);
          offset = offset + data.length;
        }
        if(data.length > 0 && toContinue){
          self.dump(callback, true, limit, offset, total_writes);
        }else if(toContinue){
          self.log('dump complete');
          if(typeof callback === 'function'){ callback(total_writes); }
        }else if(toContinue === false){
          self.log('dump ended with error');
          if(typeof callback === 'function'){ callback(total_writes); }
        }
      });
    });
  }
};

exports.elasticdump = elasticdump;
