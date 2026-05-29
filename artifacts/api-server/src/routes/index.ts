import { Router, type IRouter } from "express";
import healthRouter from "./health";
import playerRouter from "./player";

const router: IRouter = Router();

router.use(healthRouter);
router.use(playerRouter);

export default router;
