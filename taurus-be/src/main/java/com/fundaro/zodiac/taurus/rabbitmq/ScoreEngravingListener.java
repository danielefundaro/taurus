package com.fundaro.zodiac.taurus.rabbitmq;

import com.fundaro.zodiac.taurus.config.ScoreEngravingQueueConfiguration;
import com.fundaro.zodiac.taurus.multitenancy.TenantSchemaRegistry;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreEngravingQueue;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreEngravingQueue.JobMessage;
import com.fundaro.zodiac.taurus.service.scorewriting.ScoreEngravingWorker;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * Runs the engraving jobs of the queue, as many at a time as configured. Messages that cannot be used are dropped
 * instead of being delivered again forever; the job table decides what still has to run.
 */
@Component
public class ScoreEngravingListener {

    private static final Logger log = LoggerFactory.getLogger(ScoreEngravingListener.class);

    private final ScoreEngravingQueue queue;
    private final ScoreEngravingWorker worker;
    private final TenantSchemaRegistry tenantSchemaRegistry;

    public ScoreEngravingListener(ScoreEngravingQueue queue, ScoreEngravingWorker worker, TenantSchemaRegistry tenantSchemaRegistry) {
        this.queue = queue;
        this.worker = worker;
        this.tenantSchemaRegistry = tenantSchemaRegistry;
    }

    @RabbitListener(
        id = "scoreEngraving",
        queues = ScoreEngravingQueueConfiguration.QUEUE,
        concurrency = "${application.score-writing.engraving.concurrency:1}"
    )
    public void receive(Message message) {
        JobMessage job;
        try {
            job = queue.read(message);
        } catch (IOException exception) {
            throw new AmqpRejectAndDontRequeueException("Unreadable engraving message", exception);
        }
        if (job.tenant() == null || job.jobId() == null || !tenantSchemaRegistry.isActive(job.tenant())) {
            log.warn("Engraving message for an unknown tenant or job dropped");
            throw new AmqpRejectAndDontRequeueException("Engraving message without an active tenant");
        }
        worker.run(job.tenant(), job.jobId());
    }
}
