const os = require('os')
const process = require('process')
const messageService = require('../../services/message/message-service')
const roomService = require('../../services/room/room-service')
const channel = require('../../../config').wsSettings.scaleout.channel
const storage = require('./ws-storage')
const fastJson = require('fast-json-stringify')
const processName = `${os.hostname()}_${process.pid}`

class WsDispatcher {
  constructor () {
    storage.clients = {}
    storage.anonymous = 'Anonymous'
    this.publisher = null
  }

  initPublisher (publisher) {
    this.publisher = publisher
  }

  async getRecepients (op, messages) {
    let recepients = []
    let stringify
    let extension = (record, userid) => record
    if (op.startsWith('MESSAGE_')) {
      recepients = messageService.recepients(messages)
      stringify = fastJson(require('../message/message-schema').wsMessage.valueOf())
      extension = messageService.extension
    }
    if (op.startsWith('CONNECTION_') && messages.length && messages[0].user) {
      const rooms = await roomService.getAll(messages[0].user, 0, 10000)
      recepients = roomService.recepients(rooms)
      stringify = fastJson(require('../connection/connection-schema').wsConnection.valueOf())
    }
    if (op.startsWith('ROOM_CREATE')) {
      const rooms = messages
      recepients = roomService.recepients(rooms)
      stringify = fastJson(require('../room/room-schema').wsRoomCreate.valueOf())
    }
    if (op.startsWith('ROOM_UPDATE')) {
      const children = messages.map(m => m.children).reduce((a, b) => a.concat(b), [])
      const rooms = messages.map(m => m.room).concat(children)
      recepients = roomService.recepients(rooms)
      stringify = fastJson(require('../room/room-schema').wsRoomUpdate.valueOf())
    }
    if (op.startsWith('ROOM_DELETE')) {
      const children = messages.map(m => m.children).reduce((a, b) => a.concat(b), [])
      const rooms = messages.map(m => m.room).concat(children)
      recepients = roomService.recepients(rooms)
      stringify = fastJson(require('../room/room-schema').wsRoomDelete.valueOf())
    }
    if (op.startsWith('ROOM_INVITE_')) {
      const rooms = messages.map(m => m.room)
      recepients = roomService.recepients(rooms)
      stringify = fastJson(require('../invite/invite-schema').wsInvite.valueOf())
    }
    if (op.startsWith('ROOM_PEER_')) {
      const rooms = messages.map(m => m.room)
      const users = messages.map(m => m.users).reduce((a, b) => [...a, ...b], [])

      recepients = roomService.recepients(rooms, users)
      stringify = fastJson(require('../room/room-schema').wsRoomUsers.valueOf())
    }
    if (op.startsWith('ROOM_CALL_')) {
      const rooms = messages.map(m => m.room)
      recepients = roomService.recepients(rooms)
      stringify = fastJson(require('../room/room-schema').wsRoomCall.valueOf())
    }
    // TODO: Add other ROUTES (RECEPIENTS)
    return {
      recepients,
      stringify,
      extension
    }
  }

  sendRecepients (op, recepients, stringify, extension, messages) {
    recepients.forEach((r) => {
      const recepient = JSON.stringify(r)
      if (storage.clients[recepient]) {
        const clientConns = storage.clients[recepient]
        if (clientConns && clientConns.length) {
          if (clientConns[0].user) {
            clientConns.forEach((client) => {
              if (client.readyState === 1) {
                if (messages.length) {
                  const data = messages.map(m => extension(m, r))
                  client.send(stringify({
                    op,
                    data
                  }))
                }
              }
            })
          }
        }
      }
    })
  }

  scaleoutMessages (op, messages, scaleout) {
    if (scaleout && this.publisher && this.publisher.status === 'ready') {
      this.publisher.publish(channel, JSON.stringify({
        process: processName,
        op,
        messages
      }))
    }
  }

  async dispatch (op, messages, scaleout = true) {
    const { recepients, stringify, extension } = await this.getRecepients(op, messages)
    this.sendRecepients(op, recepients, stringify, extension, messages)
    this.scaleoutMessages(op, messages, scaleout)
  }
}

module.exports = new WsDispatcher()
