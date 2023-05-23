import { Debugger } from "./debugger";
const $d:Debugger = Debugger.Get();
const bcrypt = require('bcrypt-nodejs');
import * as express from "express";
import { MongoClient, Db, Collection, MongoError, InsertOneResult, ObjectId } from 'mongodb';
const yaml = require('js-yaml');

export function ErrOutText(msg:string, res: any) {
    res.setHeader('Content-Type', 'text/plain');
    res.send(msg);
}

export function RegisterRobot(req:express.Request, res:express.Response, set_password:string, robotsCollection:Collection, public_address:string, sio_port:number) {
    let remote_ip:string = (req.headers['x-forwarded-for'] || req.socket.remoteAddress) as string;
    const saltRounds = 10;
    bcrypt.genSalt(saltRounds, async function (err:any, salt:string) {
        if (err) { $d.err('Error while generating salt'); return ErrOutText( 'Error while registering', res ); }

        bcrypt.hash(set_password, salt, null, async function (err:any, hash:string) {
            if (err) { $d.err('Error while hashing password'); return ErrOutText( 'Error while registering', res ); }

            let dateRegistered = new Date();

            let robotReg:InsertOneResult = await robotsCollection.insertOne({
                registered: dateRegistered,
                reg_ip: remote_ip,
                key_hash: hash
            });

            let new_config:any = {
                id_robot: robotReg.insertedId.toString(),
                key: set_password,
                sio_address: public_address,
                sio_path: '/robot/socket.io',
                sio_port: sio_port,
                sio_ssl_verify: true
            };

            let writeYAML = req.query.yaml !== undefined;
            $d.l('Registered new robot ('+(writeYAML?'yaml':'json')+')', new_config)

            if (writeYAML) {

                new_config = {
                    '/**': {
                        'ros__parameters': new_config
                    }
                }
                res.setHeader('Content-Type', 'application/text');
                let comments = ['# Generated by '+public_address,
                                '# On '+dateRegistered.toISOString(),
                                '# For IP '+remote_ip]
                res.send(
                    comments.join('\n') + '\n\n' +
                    yaml.dump(new_config)
                );
                return;
            }

            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify(new_config, null, 4));
            return;

        });
    });
}


export function GetCerts (priv: string, pub: string) : string[] {
    let certFiles : string[] = [priv, pub];
    const fs = require('fs');
    for (var i = 0; i < 2; i++) {
        if (!fs.existsSync(certFiles[i])) {
            $d.log((certFiles[i]+" not found. Run `sh ./ssl/gen.sh` to generate a self signed SSL certificate").red);
            break;
        }
    }
    return certFiles;
}

export function UncaughtExceptionHandler (err: any, dieOnException:boolean) : void {

    //const $t = $s.$t;

    //console.log(srv);
    $d.log("[EXCEPTION]".bgRed);
    $d.log(err);

    $d.log(err.stack);
    if (err && err.code && typeof err.code === 'string' && err.code.indexOf('EADDRINUSE') !== -1) Die("Port busy");
    if (dieOnException) {
        Die();
    }
}

export function Die (message?: string) : void{
    var m = "Kthxbye!";
    if (message) m += " [" + message + "]";
    $d.log(m.bgRed);
    process.exit(1);
}



