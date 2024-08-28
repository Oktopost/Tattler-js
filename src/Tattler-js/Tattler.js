(function ()
{
	'use strict';
	
	
	let defaults = {
		ws:                undefined,
		auth:              undefined,
		urls:              {
			ws:       '/_tattler/ws',
			channels: '/_tattler/channels',
			auth:     '/_tattler/auth'
		},
		requests:          {
			ws:       'get',
			channels: 'get',
			auth:     'get'
		},
		readyCallback:     false,
		readyCallbackOnce: false,
		autoConnect:       true, // automatically init plugin
		debug:             false // show messages in console
	};
	
	let tattlerInstances = {};
	
	function extendConfig(defaultConfig, newConfig)
	{
		let result = defaultConfig;
		
		for (let key in newConfig) {
			if (newConfig.hasOwnProperty(key)) {
				result[key] = newConfig[key];
			}
		}
		
		return result;
	}
	
	const NativeAjax = function ()
	{
		let methods = {
			get: 'GET',
			post: 'POST'
		};
		
		const serialize =  function (obj, prefix)
		{
			let str = [], p;
			for (p in obj)
			{
				if (obj.hasOwnProperty(p))
				{
					let k = prefix ? prefix + '[' + p + ']' : p, v = obj[p];
					str.push((v !== null && typeof v === 'object') ?
					serialize(v, k) :
					encodeURIComponent(k) + '=' + encodeURIComponent(v));
				}
			}
			return str.join('&');
		};
		
		this._request = function(type, url, params)
		{
			let callbacks =
			{
				success: [],
				fail: [],
				complete: []
			};
			
			const requestObject = function()
			{				
				this._xmlhttp = new XMLHttpRequest();
				this._xmlhttp.onreadystatechange = this._onReadyStateChange;
				
				let data = '';
				
				if (type === 'GET')
				{
					let glue = '?';
					
					if (url.match(/\?/))
					{
						glue = '&';
					}
					
					url += glue + serialize(data);
					data = '';
				}
				else
				{
					data = JSON.stringify(params);
				}
				
				this._xmlhttp.open(type, url, true);
				this._xmlhttp.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
				
				return this._xmlhttp.send(data);
			};
			
			requestObject.prototype._onReadyStateChange = function ()
			{
				if (this._xmlhttp.readyState === XMLHttpRequest.DONE)
				{
					if (this._xmlhttp.status >= 200 && this._xmlhttp.status < 300)
					{
						let resolved;
						
						try
						{
							resolved = JSON.parse(this._xmlhttp.responseText);
						}
						catch(e)
						{
							resolved = this._xmlhttp.responseText;
						}
						
						for(let s in callbacks.success)
						{
							callbacks[s](resolved);
						}
						
						for(let c in callbacks.complete)
						{
							callbacks[c](true);
						}
					}
					else
					{
						let payload = this._xmlhttp.response;
						
						for(let f in callbacks.fail)
						{
							callbacks[f](payload);
						}
						
						for(let c in callbacks.complete)
						{
							callbacks[c](false);
						}
					}
				}
			};
			
			requestObject.onDone = function(callback)
			{
				
				callbacks.success.push(callback);
			};
			
			requestObject.onFail = function(callback)
			{
				
				callbacks.fail.push(callback);
			};
			
			requestObject.onComplete = function(callback)
			{
				
				callbacks.complete.push(callback);
			};
			
			return new requestObject(type, url, params);
		};
		
		this.get = function(url, params)
		{
			return this._request(methods.get, url, params);
		};
		
		this.post = function(url, params)
		{
			return this._request(methods.post, url, params);
		};
	};
	
	function guid()
	{
		function s4()
		{
			return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
		}
		
		return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
	}
	
	function isEmpty(obj)
	{
		for (let prop in obj)
		{
			if (obj.hasOwnProperty(prop))
				return false;
		}
		
		return JSON.stringify(obj) === JSON.stringify({});
	}
	
	const TattlerFactory =
		{
			getInstance: function (instanceName) {
				return tattlerInstances[instanceName];
			},
			create: function (config) {
				let instance = new Tattler(config);
				tattlerInstances[guid()] = instance;
				return instance;
			}
		};
	
	const Tattler = function (options)
	{
		let messageIds = [];
		const settings = extendConfig(defaults, options);
		let ajaxImplementer = false;
		
		const callbacks = {
			getWs: {
				onSuccess: function (data)
						   {
							   manufactory.server = data.ws;
							   connectToSocket();
						   },
				
				onError: function ()
						 {
							 log('error', 'Failed to get ws address');
						 }
			},
			getChannels: {
				onSuccess: function (data) {
					for (let i in data.channels) {
						if (data.channels.hasOwnProperty(i)) {
							addChannel(data.channels[i], true, true);
						}
					}
					callbacks.socket.handleEvents();
					
					if (typeof settings.readyCallback === 'function') {
						settings.readyCallback();
					}
					
					if (typeof settings.readyCallbackOnce === 'function') {
						settings.readyCallbackOnce();
						settings.readyCallbackOnce = false;
					}
				},
				onError: function () {
					log('error', 'Failed to get channels listing');
				}
			},
			socket: {
				connected: function () {
					requestChannels();
					log('warn', 'connected to socket');
				},
				disconnected: function () {
					log('warn', 'disconnected from socket');
					for (let i in manufactory.channels) {
						if (manufactory.channels.hasOwnProperty(i)) {
							manufactory.channels[i] = false;
						}
					}
				},
				handleEvents: function () {
					if (typeof manufactory.socket._callbacks['$defaultEvent'] !== 'undefined') {
						return;
					}
					
					/** @namespace data.payload */
					manufactory.socket.on('defaultEvent', function (data) {
						let id = data.id || Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 30);
						let handler = data.handler;
						let namespace = data.namespace || 'global';
						
						for (let i = 0; i < 10; i++) {
							if (!messageIds.hasOwnProperty(i)) {
								break;
							}
							
							if (messageIds[i] === id) {
								log('info', 'preventing duplicate message processing', data);
								return;
							}
						}
						
						messageIds.unshift(id);
						messageIds.length = 10;
						
						
						if (handlerExists(namespace, handler) === false) {
							log('error', 'handler ' + handler + ' with namespace ' + namespace + ' not defined', data);
						} else {
							for (let funcKey=0; funcKey<manufactory.handlers[namespace][handler].length; funcKey++)
							{
								if (typeof data.payload === 'undefined') {
									// backward compatibility to old version of Tattler backend
									manufactory.handlers[namespace][handler][funcKey](data);
								} else {
									manufactory.handlers[namespace][handler][funcKey](data.payload);
								}
							}
						}
					})
				}
			}
		};
		
		const manufactory =
			{
				socket: null,
				server: null,
				port: null,
				channels: {},
				handlers: {
					/** @namespace data.channel */
					global: {
						'console.log': [function (data) {
							if (typeof data.force !== 'undefined') {
								console.warn(data);
								return;
							}
							
							if (settings.debug === true) {
								log('warn', '-------------------------------------------------------------');
								log('warn', 'remote: ' + data.message);
								log('warn', '-------------------------------------------------------------');
							} else {
								log('warn', 'remote', data.message);
							}
						}],
						'alert': [function (data) {
							let text;
							if (typeof data.title !== 'undefined') {
								text = data.title
							}
							
							if (text !== '') {
								text = '--------------------------' + text.toUpperCase() + '--------------------------';
								text += "\n";
							}
							
							text += data.message;
							
							alert(text);
						}],
						'confirm': [function (data) {
							if (confirm(data.message)) {
								if (data.yes !== undefined && typeof data.yes === 'function') {
									data.yes();
								}
							} else {
								if (data.no !== undefined && typeof data.no === 'function') {
									window[data.no]();
								}
							}
						}],
						'addChannel': [function (data) {
							addChannel(data.channel, false);
						}],
						'removeChannel': [function (data) {
							removeChannel(data.channel);
						}]
					}
				}
			};
		
		let logs = [];
		
		const handlerExists = function (namespace, event)
		{
			return typeof manufactory.handlers[namespace] !== 'undefined' &&
			typeof manufactory.handlers[namespace][event] !== 'undefined';
		};
		
		const getAjax = function()
		{
			if (!ajaxImplementer)
			{
				return new NativeAjax();
			}
			
			return ajaxImplementer;
		};
		
		const subscribeChannel = function (channel, state)
		{
			manufactory.socket.emit('subscribe', channel);
			
			if (typeof state === 'undefined')
			{
				manufactory.channels[channel] = true;
			}
		};
		
		const addChannel = function (channel, state, notAsync)
		{
			if (typeof manufactory.channels[channel] === 'undefined' || manufactory.channels[channel] !== state)
			{
				manufactory.channels[channel] = state;
				
				if (manufactory.socket !== null)
				{
					log('info', 'joining channel «' + channel + '»');
					
					if (typeof notAsync === 'boolean' && notAsync === true)
					{
						subscribeChannel(channel, state);
					}
					else
					{
						getAjax()[settings.requests.channels](settings.urls.channels,
						{
							socketId: manufactory.socket.id,
							channels: [channel]
						}).onDone(function (data) {
							for (let i in data.channels) {
								if (data.channels.hasOwnProperty(i)) {
									subscribeChannel(data.channels[i], state);
								}
							}
						})
						.onFail(callbacks.getChannels.onError);
					}
					
				}
				else
				{
					log('info', 'adding channel «' + channel + '»');
				}
			}
			else
			{
				log('error', 'channel «' + channel + '» already defined');
			}
		};
		
		const removeChannel = function (channel)
		{
			if (typeof manufactory.channels[channel] === 'undefined')
			{
				log('error', 'failed to unsubscribe from «' + channel + '» - channel not defined');
			}
			else
			{
				delete(manufactory.channels[channel]);
				manufactory.socket.emit('unsubscribe', channel);
				log('warn', 'unsubscribed from «' + channel + '»')
			}
		};
		
		const addHandler = function (event, namespace, fn)
		{
			if (typeof namespace === 'function') {
				// backward compatibility with old handlers
				fn = namespace;
				namespace = 'global';
			}
			
			
			if (typeof manufactory.handlers[namespace] === 'undefined')
			{
				manufactory.handlers[namespace] = {};
			}
			
			if (typeof manufactory.handlers[namespace][event] === 'undefined')
			{
				manufactory.handlers[namespace][event] = [];
			}
			
			manufactory.handlers[namespace][event].push(fn);
			log('info', 'added handler for event «' + event + '» in namespace «' + namespace + '»');
		};
		
		const removeHandler = function(event, namespace)
		{
			if (typeof manufactory.handlers[namespace] !== 'undefined' && typeof manufactory.handlers[namespace][event] !== 'undefined')
			{
				log('info', 'removed handler(s) for event «' + event + '» in namespace «' + namespace + '»');
				delete manufactory.handlers[namespace][event];
			}
			else
			{
				log('warn', 'failed to remove handler for event «' + event + '» in namespace «' + namespace + '»: handler not found');
			}
		};
		
		const log = function ()
		{
			let args = [];
			let result = {};
			
			for (let i = 0; i < arguments.length; i++) {
				args.push(arguments[i]);
			}
			
			let type = args.shift();
			
			result.type = type;
			result.date = new Date();
			result.data = args;
			
			logs.push(result);
			
			if (settings.debug === true) {
				args.unshift('Tattler:');
				for (let x in args) {
					if (typeof args[x] === 'object') {
						console[type](args);
						return;
					}
				}
				
				window.console[type](args.join(' '));
			}
		};
		
		const setAjaxImplementer = function(library)
		{
			ajaxImplementer = library;
		};
		
		
		const debug = function ()
		{
			for (let item in logs) {
				console[logs[item].type](logs[item].date, logs[item].data);
			}
		};
		
		const init = function ()
		{
			if (typeof options.ws !== 'undefined')
			{
				manufactory.server = options.ws;
				log('info', 'using WS url ' + options.ws);
				connectToSocket();
			}
			else
			{
				log('info', 'requesting WS url');
				getAjax()[settings.requests.ws](settings.urls.ws, {}).onDone(callbacks.getWs.onSuccess).onFail(callbacks.getWs.onError);
			}
		};
		
		const disconnect = function()
		{
			if (manufactory.socket === null) {
				return;
			}
			
			manufactory.socket.disconnect();
			manufactory.socket = null;
		};
		
		const getJWT = function (onSuccess, onFail)
		{
			if (typeof options.auth !== 'undefined')
			{
				onSuccess(options.auth);
			}
			else
			{
				getAjax()[settings.requests.auth](settings.urls.auth, {}).onDone(function (jqXHR) {
					onSuccess(jqXHR.token);
				}).onFail(onFail);
			}
		};
		
		const connectToSocket = function ()
		{
			if (manufactory.socket === null) {
				if (manufactory.server === null) {
					log('error', 'Failed to connect to socket: address unknown');
					return;
				}
				
				getJWT(function (token) {
					manufactory.socket = io(manufactory.server,
					{
						query: 'token=' + token
					});
					
					manufactory.socket.on('connect', callbacks.socket.connected);
					manufactory.socket.on('disconnect', callbacks.socket.disconnected);
					
					log('info', 'connecting to socket at ' + manufactory.server);
				});
			}
			else
			{
				log('error', 'socket already connected');
			}
		};
		
		const requestChannels = function ()
		{
			let socketId = manufactory.socket.id;
			let savedChannels = [];
			
			if (isEmpty(manufactory.channels))
			{
				log('log', 'requesting channels with socketId=' + socketId);
			}
			else
			{
				log('log', 'connecting to saved channels');
				
				for (let room in manufactory.channels)
				{
					if (manufactory.channels.hasOwnProperty(room)) {
						savedChannels.push(room);
					}
				}
			}
			
			getAjax()[settings.requests.channels](settings.urls.channels,
			{
				socketId: socketId,
				channels: savedChannels
			})
			.onDone(callbacks.getChannels.onSuccess)
			.onFail(callbacks.getChannels.onError);
		};
		
		if (settings.autoConnect) {
			init();
		}
		
		log('info', "creating socket's stuff...");
		
		
		this.setAjaxImplementer = setAjaxImplementer;
		this.debug = debug;
		this.addHandler = addHandler;
		this.removeHandler = removeHandler;
		this.addChannel = addChannel;
		this.removeChannel = removeChannel;
		this.run = init;
		this.disconnect = disconnect;
	};
	
	window.TattlerFactory = TattlerFactory;
	
	
	window.tattlerFactory =
	{
		getInstance: function (instanceName)
					 {
						 console.warn('tattlerFactory is deprecated, use TattlerFactory');
						 return TattlerFactory.getInstance(instanceName);
					 },
		create: function (config)
					 {
						 console.warn('tattlerFactory is deprecated, use TattlerFactory');
						 return TattlerFactory.create(config);
					 }
	};
})();