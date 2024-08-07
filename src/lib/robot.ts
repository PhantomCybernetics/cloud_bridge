import { Debugger } from "./debugger";
const $d:Debugger = Debugger.Get();

import * as SocketIO from "socket.io";
import { MongoClient, Db, Collection, MongoError, InsertOneResult, ObjectId, FindCursor } from 'mongodb';
import { App } from './app'
import { ErrOutText } from './helpers'

const bcrypt = require('bcrypt-nodejs');
import * as express from "express";
const fs = require('fs');

export class RobotSocket extends SocketIO.Socket {
    dbData?: any;
}

export class Robot {
    idRobot: ObjectId;
    name: string;
    type: ObjectId;
    isConnected: boolean;
    isAuthentificated: boolean;
    socket: RobotSocket;
    timeConnected:Date;

    nodes: any[];
    topics: any[];
    services: any[];
    docker_containers: any[];
    cameras: any[];

    static LOG_EVENT_CONNECT: number = 1;
    static LOG_EVENT_DISCONNECT: number = 0;
    static LOG_EVENT_ERR: number = -1;

    introspection: boolean;

    static connectedRobots:Robot[] = [];

    public addToConnected() {
        if (Robot.connectedRobots.indexOf(this) == -1) {
            Robot.connectedRobots.push(this);
            let robot = this;
            App.connectedApps.forEach(app => {
                let sub:any = {};
                if (app.isSubscribedToRobot(this.idRobot, sub)) {
                    $d.log('Stored sub: ', sub);
                    robot.initPeer(app, sub.read, sub.write)
                }
            });
        }
    }

    public initPeer(app:App, read?:string[], write?:string[][], returnCallback?:any) {
        let data = {
            id_app: app.idApp.toString(),
            id_instance: app.idInstance.toString(),
            read: read,
            write: write,
        }
        let that = this;
        $d.log('Calling robot:peer with data', data);
        this.socket.emit('peer', data, (answerData:any) => {

            if (!app.socket)
                return;

            $d.log('Got robot\'s answer:', answerData);

            answerData = this.getStateData(answerData);
            answerData['files_fw_secret'] = app.filesSecret.toString();

            if (returnCallback) {
                returnCallback(answerData);
            } else {
                app.socket.emit('robot', answerData, (app_answer_data:any) => {
                    $d.log('Got app\'s answer:', app_answer_data);
                    delete app_answer_data['id_robot'];
                    app_answer_data['id_app'] = app.idApp.toString();
                    app_answer_data['id_instance'] = app.idInstance.toString();
                    that.socket.emit('sdp:answer', app_answer_data);
                });
            }

            if (!app.socket)
                return;

            app.socket.emit('nodes', this.AddId(this.nodes));
            app.socket.emit('topics', this.AddId(this.topics));
            app.socket.emit('services', this.AddId(this.services));
            app.socket.emit('cameras', this.AddId(this.cameras));
            app.socket.emit('docker', this.AddId(this.docker_containers));
        });
    }

    public removeFromConnected(notify:boolean = true) {
        let index = Robot.connectedRobots.indexOf(this);
        if (index != -1) {
            Robot.connectedRobots.splice(index, 1);
            if (notify) {
                let that = this;
                App.connectedApps.forEach(app => {
                    if (app.isSubscribedToRobot(this.idRobot)) {
                        app.socket.emit('robot', that.getStateData()) //offline
                    }
                });
            }
        }
    }

    public getStateData(data:any=null):any {
        if (!data || typeof data !== 'object')
            data = {};

        data['id_robot'] = this.idRobot.toString()
        data['name'] =  this.name ? this.name : 'Unnamed Robot';
    
        if (this.socket)
            data['ip'] =  this.socket.conn.remoteAddress; //no ip = robot offline
        data['introspection'] = this.introspection;

        return data;
    }

    public AddId(inData:any):any {
        let data:any = {};
        data[this.idRobot.toString()] = inData;
        return data;
    }

    public NodesToSubscribers():void {
        let robotNodesData = this.AddId(this.nodes);
        App.connectedApps.forEach(app => {
            if (app.isSubscribedToRobot(this.idRobot)) {
                app.socket.emit('nodes', robotNodesData)
            }
        });
    }

    public TopicsToSubscribers():void {
        let robotTopicsData = this.AddId(this.topics);
        App.connectedApps.forEach(app => {
            if (app.isSubscribedToRobot(this.idRobot)) {
                app.socket.emit('topics', robotTopicsData)
            }
        });
    }

    public ServicesToSubscribers():void {
        let robotServicesData = this.AddId(this.services);
        App.connectedApps.forEach(app => {
            if (app.isSubscribedToRobot(this.idRobot)) {
                // $d.l('emitting services to app', robotServicesData);
                app.socket.emit('services', robotServicesData)
            }
        });
    }

    public CamerasToSubscribers():void {
        let robotCamerasData = this.AddId(this.cameras);
        App.connectedApps.forEach(app => {
            if (app.isSubscribedToRobot(this.idRobot)) {
                // $d.l('emitting cameras to app', robotCamerasData);
                app.socket.emit('cameras', robotCamerasData)
            }
        });
    }

    public IntrospectionToSubscribers():void {
        App.connectedApps.forEach(app => {
            if (app.isSubscribedToRobot(this.idRobot)) {
                // $d.l('emitting discovery state to app', discoveryOn);
                app.socket.emit('introspection', this.introspection)
            }
        });
    }

    public DockerContainersToSubscribers():void {
        let robotDockerContainersData = this.AddId(this.docker_containers);
        App.connectedApps.forEach(app => {
            if (app.isSubscribedToRobot(this.idRobot)) {
                // $d.l('emitting docker to app', robotDockerContainersData);
                app.socket.emit('docker', robotDockerContainersData)
            }
        });
    }

    public logConnect(robotsCollection:Collection, robotLogsCollection:Collection):void {

        this.timeConnected = new Date();
        robotsCollection.updateOne({_id: this.idRobot},
                                   { $set: {
                                        name: this.name,
                                        last_connected: this.timeConnected,
                                        last_ip: this.socket.handshake.address,
                                    }, $inc: { total_sessions: 1 } });

        robotLogsCollection.insertOne({
            id: this.idRobot,
            stamp: this.timeConnected,
            event: Robot.LOG_EVENT_CONNECT,
            ip: this.socket.handshake.address
        });

    }

    public logDisconnect(robotsCollection:Collection, robotLogsCollection:Collection, ev:number = Robot.LOG_EVENT_DISCONNECT, cb?:any):void {

        let numTasks = 2;
        let now:Date = new Date();
        let session_length_min:number = Math.abs(now.getTime() - this.timeConnected.getTime())/1000.0/60.0;
        robotsCollection.updateOne({_id: this.idRobot},
                                   { $inc: { total_time_h: session_length_min/60.0 } })
        .finally(()=>{
            numTasks--;
            if (!numTasks && cb) return cb();
        });

        robotLogsCollection.insertOne({
            id: this.idRobot,
            stamp: new Date(),
            event: ev,
            session_length_min: session_length_min,
            ip: this.socket.handshake.address
        }).finally(()=>{
            numTasks--;
            if (!numTasks && cb) return cb();
        });
    }

    static Register(req:express.Request, res:express.Response, setPassword:string, robotsCollection:Collection) {
        let remote_ip:string = (req.headers['x-forwarded-for'] || req.socket.remoteAddress) as string;
        const saltRounds = 10;
        bcrypt.genSalt(saltRounds, async function (err:any, salt:string) {
            if (err) { $d.err('Error while generating salt'); return ErrOutText( 'Error while registering', res ); }
    
            bcrypt.hash(setPassword, salt, null, async function (err:any, hash:string) {
                if (err) { $d.err('Error while hashing password'); return ErrOutText( 'Error while registering', res ); }
    
                let dateRegistered = new Date();
    
                let robotReg:InsertOneResult = await robotsCollection.insertOne({
                    registered: dateRegistered,
                    reg_ip: remote_ip,
                    key_hash: hash
                });
    
                $d.l(('Registered new robot id '+robotReg.insertedId.toString()+' from '+remote_ip).yellow);
    
                if (req.query.yaml !== undefined) {
                    return res.redirect('/robot/register?yaml&id='+robotReg.insertedId.toString()+'&key='+setPassword);
                } else {
                    return res.redirect('/robot/register?id='+robotReg.insertedId.toString()+'&key='+setPassword);
                }
            });
        });
    }
    
    static async GetDefaultConfig(req:express.Request, res:express.Response, robotsCollection:Collection, publicAddress:string, sioPort:number) {
    
        if (!req.query.id || !ObjectId.isValid(req.query.id as string) || !req.query.key) {
            $d.err('Invalidid id_robot provided: '+req.query.id)
            res.status(403);
            return res.send('Access denied, invalid credentials');
        }
    
        let searchId = new ObjectId(req.query.id as string);
        const dbRobot = (await robotsCollection.findOne({_id: searchId }));
    
        if (dbRobot) {
            bcrypt.compare(req.query.key, dbRobot.key_hash, function(err:any, passRes:any) {
                if (passRes) { //pass match => good
                    
                    if (req.query.yaml !== undefined) {
    
                        const dir:string  = __dirname + "/../../";
                        let cfg:string = fs.readFileSync(dir+'robot_config.templ.yaml').toString(); 
                    
                        cfg = cfg.replace('%HOST%', publicAddress);
                        cfg = cfg.replace('%REG_DATE_TIME%', dbRobot.registered.toISOString());
                        cfg = cfg.replace('%REG_IP%', dbRobot.reg_ip);
    
                        cfg = cfg.replace('%ROBOT_ID%', dbRobot._id.toString());
                        cfg = cfg.replace('%ROBOT_KEY%', req.query.key as string);
    
                        cfg = cfg.replace('%SIO_ADDRESS%', publicAddress);
                        cfg = cfg.replace('%SIO_PATH%', '/robot/socket.io');
                        cfg = cfg.replace('%SIO_PORT%', sioPort.toString());
    
                        res.setHeader('Content-Type', 'application/text');
                        res.setHeader('Content-Disposition', 'attachment; filename="phntm_bridge.yaml"');
    
                        return res.send(cfg);
    
                    } else { // json - this is not very useful yet
                        // $d.l(dbRobot);
                        res.setHeader('Content-Type', 'application/json');
                        return res.send(JSON.stringify({
                            id_robot: dbRobot._id.toString(),
                            key: req.query.key,
                            sio_address: publicAddress,
                            sio_path: '/robot/socket.io',
                            sio_port: sioPort,
                        }, null, 4));
                    }
    
                } else { //invalid key
                    res.status(403);
                    return res.send('Access denied, invalid credentials');
                }
            });
    
        } else { //robot not found
            res.status(403);
            return res.send('Access denied, invalid credentials');
        }
    
    }

    public static FindConnected(idSearch:ObjectId):Robot|null {
        for (let i = 0; i < Robot.connectedRobots.length; i++)
        {
            if (!Robot.connectedRobots[i].idRobot)
                continue;
            if (Robot.connectedRobots[i].idRobot.equals(idSearch))
                return Robot.connectedRobots[i];
        }
        return null;
    }
}