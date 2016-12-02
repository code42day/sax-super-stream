var Transform = require('stream').Transform;
var StringDecoder = require('string_decoder').StringDecoder;
var sax = require('sax');
var stack = require('./stack');

module.exports = initParser;
module.exports.addChild = addChild;
module.exports.appendToCollection = appendToCollection;
module.exports.assignTo = assignTo;

function addChild(name) {
  return function(node, parent) {
    if (parent[name]) {
      return;
    }
    var child = {};
    parent[name] = child;
    return child;
  };
}

function appendToCollection(name) {
  return function(node, parent) {
    var child = {};

    if (!parent[name]) {
      parent[name] = [];
    }
    parent[name].push(child);
    return child;
  };
}

function assignTo(property) {
  return function (text, obj) {
    obj[property] = text;
  };
}

// used to mark all tags that we want to skip
var IGNORE = Object.create(null);


function stripPrefix(name) {
  var index = name.indexOf(':');
  return index < 0 ? name : name.slice(index + 1);
}


function handlers(parserConfig, fn) {
  var
    items = stack(),
    parsers = stack(parserConfig),
    context = {};

  function onopentag(node) {
    var tag = node.local;
    var tagParser = verifyNS(parsers.top()[tag]);
    var elem;

    function parseWith(tp) {
      elem = tp(node, items.top(), context);
      if (elem) {
        items.push(elem, tag);
      }
    }

    // if parser specifies namespace, it has to much naode namespace
    function verifyNS(tp) {
      if (!tp) {
        return tp;
      }
      if (!tp.$uri) {
        return tp;
      }
      if (tp.$uri === node.uri) {
        return tp;
      }
    }

    if (!tagParser) {
      parsers.push(IGNORE, tag);
      return;
    }
    if (typeof tagParser === 'function') {
      parseWith(tagParser);
    } else {
      if (typeof tagParser.$ === 'function') {
        parseWith(tagParser.$);
      }
      parsers.push(tagParser, tag);
    }
  }

  function onclosetag(tag) {
    var parser, top;

    tag = stripPrefix(tag);
    parser = parsers.pop(tag);
    if (parser && typeof parser.$after === 'function') {
      parser.$after(items.top(), context);
    }
    if (parser !== IGNORE) {
      top = items.pop(tag);
      // if nothing on the stack emit result
      if (top !== undefined && items.empty()) {
        fn(null, top);
      }
    }
  }

  function ontext(value) {
    var textParser = parsers.top().$text;
    if (textParser) {
      textParser(value, items.top(), context);
    }
  }

  return {
    onopentag: onopentag,
    onclosetag: onclosetag,
    ontext: ontext,
    onerror: fn
  };
}


function initParser(parserConfig, saxOptions) {

  saxOptions = Object.assign({
    trim: true,
    normalize: true,
    lowercase: false,
    xmlns: true,
    position: false,
    strictEntities: true,
    noscript: true
  }, saxOptions);

  var parser = sax.parser(true, saxOptions);
  var decoder = new StringDecoder('utf8');
  var results = [];
  var parserError;
  var ts;

  Object.assign(parser, handlers(parserConfig, function(err, obj) {
    if (!err) {
      results.push(obj);
    } else {
      parserError = err;
    }
  }));

  function write(chunk) {
    var str = decoder.write(chunk);
    parser.write(str);
  }

  function flush(stream) {
    if (!results.length) {
      return;
    }
    results.forEach(function(r) {
      stream.push(r);
    });
    results = [];
  }

  ts = new Transform({
    readableObjectMode: true,
    flush: function(next) {
      parser.close();
      if (parserError) {
        return next(parserError);
      }
      flush(this);
      next();
    },
    transform: function(chunk, encoding, next) {
      if (parserError) {
        return next(parserError);
      }
      write(chunk);
      flush(this);
      next();
    }
  });
  return ts;
}
